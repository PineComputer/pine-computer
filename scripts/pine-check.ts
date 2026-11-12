// Checks the studio's Pine calls against a real project, one call at a time, without the
// drama skill: a Computer is created, given two sessions, files and three small plain-language
// turns (one asks a question), hands a packed folder from one session to the other the way
// pre-production hands the project to episodes, then is stopped, started again from its saved
// credentials, started while running (a lost binding) and stopped. It goes through the same
// PineFleet the engine uses, so what passes here is what the studio does.
//
//   npm run pine:check            the project the studio saved in .data/ (or PINE_SANDBOX_*)
//
// It runs one Computer for about ten minutes, with a 5-minute idle timeout in case it is cut
// short, and Pine bills the turns at its usual rates (printed at the end).
import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
process.env.STUDIO_DATA_DIR ||= ".data";

const { Client } = await import("@pinesandbox/computer");
const { DATA_DIR, IDLE_WAITING_S, IDLE_WORKING_S } = await import("../src/engine/config.ts");
const { ENDED } = await import("../src/engine/fleet.ts");
const { DRAMA_SKILL } = await import("../src/engine/goals.ts");
const { PineFleet } = await import("../src/engine/pine-fleet.ts");
const { unseal } = await import("../src/engine/seal.ts");
const { environmentProject, keyHint } = await import("../src/engine/settings.ts");
type ComputerRef = import("../src/engine/fleet.ts").ComputerRef;
type SessionRef = import("../src/engine/fleet.ts").SessionRef;
type TurnInfo = import("../src/engine/fleet.ts").TurnInfo;

/** The project to check: the developer's override, or the one the studio saved (read only; the engine may be running). */
function project(): import("../src/engine/settings.ts").PineProject {
  const fromEnvironment = environmentProject();
  if (fromEnvironment) return fromEnvironment;
  const file = path.join(DATA_DIR, "studio.db");
  if (existsSync(file)) {
    const row = new DatabaseSync(file, { readOnly: true }).prepare("select value from settings where key = 'pine.project'").get() as { value: string } | undefined;
    if (row) return JSON.parse(unseal(row.value));
  }
  console.error(`No Pine project: connect one in the studio (data in ${DATA_DIR}), or set PINE_SANDBOX_API_KEY.`);
  process.exit(2);
}

const pine = project();
const fleet = new PineFleet(pine);
const LABEL = "pine-check";
const IDLE_S = 300;
const TURN_MS = 10 * 60_000;

let failures = 0;
let cost = 0;
let priced = true;

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/** One check: its name, how long it took, and what it found; a failure is reported and the run goes on where it can. */
async function step<T>(name: string, work: () => Promise<{ value: T; note: string }>): Promise<T | undefined> {
  const started = Date.now();
  try {
    const { value, note } = await work();
    console.log(`  ok    ${name.padEnd(28)} ${seconds(Date.now() - started).padStart(7)}  ${note}`);
    return value;
  } catch (error) {
    failures += 1;
    console.log(`  FAIL  ${name.padEnd(28)} ${seconds(Date.now() - started).padStart(7)}  ${(error as Error).message}`);
    return undefined;
  }
}

function expect(condition: unknown, what: string): asserts condition {
  if (!condition) throw new Error(what);
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function read(ref: ComputerRef, session: SessionRef, file: string): Promise<Buffer> {
  return Buffer.from(await new Response(await fleet.openFile(ref, session, file)).arrayBuffer());
}

/** Follows a turn to its end the way the engine does: wait in slices, and past an answered question to the turn it opened. */
async function finish(ref: ComputerRef, session: SessionRef, first: TurnInfo): Promise<TurnInfo> {
  let info = first;
  const until = Date.now() + TURN_MS;
  while (!ENDED.has(info.state)) {
    if (Date.now() > until) throw new Error(`turn ${info.turnId} still ${info.state} after ${TURN_MS / 60_000} minutes`);
    info = await fleet.wait(ref, session, info.turnId, 25_000);
    if (info.state === "answered" && info.nextTurnId) info = await fleet.wait(ref, session, info.nextTurnId, 0);
  }
  if (info.cost === null) priced = false;
  else cost += info.cost;
  return info;
}

function ended(info: TurnInfo, state: string): void {
  expect(info.state === state, `ended ${info.state}${info.summary ? `: ${info.summary.slice(0, 200)}` : ""}${info.question ? `: ${info.question.slice(0, 200)}` : ""}`);
}

function returned(info: TurnInfo): string {
  return info.files.map((file) => file.path).join(", ") || "no files";
}

console.log(`Pine check: ${new URL(pine.endpoint).host}, key ${keyHint(pine.apiKey)}\n`);

let ref: ComputerRef | undefined;
let credentials = "";
const sessions: SessionRef[] = [];

try {
  const limits = await step("project policy", async () => {
    const limits = await fleet.limits();
    const idle = limits.idleAdjustable ? (limits.maxIdleSeconds ? `up to ${limits.maxIdleSeconds / 3600}h, adjustable` : "adjustable") : "set at start only (no lifetime policy)";
    const runtime = limits.maxRuntimeSeconds ? `${limits.maxRuntimeSeconds / 3600}h per start` : "no limit";
    return { value: limits, note: `Computers at once: ${limits.maxComputers ?? "no limit"} · idle timeout: ${idle} · running time: ${runtime}` };
  });

  ref = await step("create a Computer", async () => {
    const made = await fleet.newCredentials();
    credentials = made.credentials;
    const attached = await fleet.createComputer(made.credentials, LABEL, IDLE_S);
    return { value: { id: made.id, credentials: made.credentials, binding: attached.binding }, note: made.id };
  });
  if (!ref) throw new Error("No Computer, so nothing else can be checked.");
  const computer = ref;

  await step("status", async () => {
    const state = await fleet.status(computer);
    expect(state === "running", `status is ${state}`);
    return { value: state, note: state };
  });

  await step("running time", async () => {
    const stopBy = await fleet.stopBy(computer);
    return { value: stopBy, note: stopBy ? `Pine stops it from ${stopBy.toISOString()} (${((stopBy.getTime() - Date.now()) / 3_600_000).toFixed(1)}h from now)` : "no limit" };
  });

  await step("skills", async () => {
    const skills = await fleet.skills(computer);
    const drama = skills.includes(DRAMA_SKILL);
    return { value: skills, note: `${skills.length} offered; ${DRAMA_SKILL}: ${drama ? "yes" : "NOT OFFERED (the studio will hold dramas on this project)"}` };
  });

  await step("idle timeout", async () => {
    // The studio lengthens it while a session waits on the maker, where the project allows.
    if (limits && !limits.idleAdjustable) return { value: false, note: "fixed at start on this project; the studio starts with the waiting timeout" };
    // As the studio does: longer while a session waits on the maker, then back.
    const clamp = (seconds: number) => (limits?.maxIdleSeconds ? Math.min(seconds, limits.maxIdleSeconds) : seconds);
    for (const seconds of [clamp(IDLE_WAITING_S), clamp(IDLE_WORKING_S), IDLE_S]) {
      const applied = await fleet.setIdleTimeout(computer, seconds);
      expect(applied === seconds, `asked for ${seconds}s, Pine applied ${applied}s`);
    }
    return { value: true, note: `${clamp(IDLE_WAITING_S) / 3600}h while waiting, ${clamp(IDLE_WORKING_S) / 3600}h working, applied as asked` };
  });

  // Session A: attachments in, a plain turn, files out (also from a nested folder).
  const a = await step("session A", async () => {
    const session = await fleet.createSession(computer, "check A");
    sessions.push(session);
    return { value: session, note: session.name };
  });
  const blob = randomBytes(3 * 1024 * 1024);
  const events = { input: 0, progress: 0, activity: 0, result: 0, usage: 0 };
  const listening = new AbortController();
  let following: Promise<void> | undefined;
  /** The session's events, from its first run on (before that it has no task to follow), as the engine reads them. */
  const listen = (session: SessionRef) =>
    (following ??= (async () => {
      try {
        for await (const event of fleet.events(computer, session, undefined, undefined, listening.signal)) events[event.kind] += 1;
      } catch (error) {
        if (!listening.signal.aborted) console.log(`        events stopped: ${(error as Error).message}`);
      }
    })());

  if (a) {
    await step("attachments", async () => {
      await fleet.writeFile(computer, a, "note.txt", Buffer.from("The quick brown fox\nsecond line\n"));
      await fleet.writeFile(computer, a, "look-林晚-v1.txt", Buffer.from("你好\n"));
      await fleet.writeFile(computer, a, "blob.bin", blob);
      // Attachments show in the working directory as attachments/<name>; names in Chinese (looks are named after characters) must survive.
      expect((await read(computer, a, "attachments/look-林晚-v1.txt")).toString() === "你好\n", "the attachment with a Chinese name didn't read back intact");
      return { value: true, note: "note.txt, look-林晚-v1.txt, blob.bin (3 MiB); read back intact" };
    });

    await step("a plain turn", async () => {
      const goal = [
        "This is a short connectivity check; don't browse the web. In the shell, in your working directory:",
        "1. Write reply.txt containing the first line of attachments/note.txt in upper case.",
        "2. Write sums.txt with the output of `sha256sum attachments/blob.bin`.",
        "3. Write out/nested/deep.txt containing the word nested.",
        "Return reply.txt, sums.txt and out/nested/deep.txt as your result files.",
      ].join("\n");
      const sent = await fleet.run(computer, a, goal, `check-${Date.now()}-plain`);
      listen(a);
      const info = await finish(computer, a, sent);
      ended(info, "completed");
      const paths = info.files.map((file) => file.path);
      for (const wanted of ["reply.txt", "sums.txt", "out/nested/deep.txt"]) expect(paths.includes(wanted), `returned ${returned(info)}; no ${wanted}`);
      for (const file of info.files) {
        const body = await read(computer, a, file.path);
        expect(sha256(body) === file.sha256, `${file.path}: downloaded bytes don't match the sha256 Pine listed`);
      }
      expect((await read(computer, a, "reply.txt")).toString().trim() === "THE QUICK BROWN FOX", "reply.txt is wrong");
      const sums = (await read(computer, a, "sums.txt")).toString();
      expect(sums.includes(sha256(blob)), "blob.bin arrived changed (its sha256 differs)");
      return { value: info, note: `returned ${returned(info)}; contents match` };
    });

    await step("a question, then the answer", async () => {
      const goal = "Ask me one question: which colour should the title card be? Wait for my answer, then write colour.txt containing only my answer, and return it.";
      const asked = await finish(computer, a, await fleet.run(computer, a, goal, `check-${Date.now()}-question`));
      ended(asked, "needs_input");
      expect(asked.question.trim(), "the turn waits but asked nothing");
      const opened = await fleet.answer(computer, a, asked.turnId, "Teal.");
      // The engine follows an answered turn to the one the answer opened (follow.ts).
      const before = await fleet.wait(computer, a, asked.turnId, 0);
      expect(before.state === "answered" && before.nextTurnId === opened.turnId, `the answered turn reads ${before.state}, next ${before.nextTurnId || "none"} (the answer opened ${opened.turnId})`);
      const done = await finish(computer, a, opened);
      ended(done, "completed");
      expect(done.files.some((file) => file.path === "colour.txt"), `returned ${returned(done)}; no colour.txt`);
      expect(/teal/i.test((await read(computer, a, "colour.txt")).toString()), "colour.txt doesn't hold the answer");
      return { value: done, note: `asked "${asked.question.trim().slice(0, 60)}", answered, finished` };
    });

    // The handoff: pack in one session, restore in another (sessions don't share files).
    const parts = await step("pack a folder in parts", async () => {
      const goal = [
        "In the shell, in your working directory:",
        "1. `mkdir -p project/notes && head -c 2621440 /dev/urandom > project/data.bin && echo 'look v1' > project/notes/林晚.md`",
        "2. `mkdir -p handoff && tar -cf - project | split -b 1m - handoff/project.tar.part-`",
        "3. `sha256sum project/data.bin > handoff/project.sha256`",
        "Return every file in handoff/ as your result files.",
      ].join("\n");
      const info = await finish(computer, a, await fleet.run(computer, a, goal, `check-${Date.now()}-pack`));
      ended(info, "completed");
      const pieces = info.files.filter((file) => /^handoff\/project\.tar\.part-/.test(file.path)).sort((x, y) => x.path.localeCompare(y.path));
      expect(pieces.length >= 3, `returned ${returned(info)}; expected at least 3 parts`);
      const sum = info.files.find((file) => file.path === "handoff/project.sha256");
      expect(sum, `returned ${returned(info)}; no handoff/project.sha256`);
      const downloaded = await Promise.all(pieces.map(async (file) => ({ name: path.posix.basename(file.path), body: await read(computer, a, file.path) })));
      const expected = (await read(computer, a, sum.path)).toString().split(/\s+/)[0];
      return { value: { downloaded, expected }, note: `${pieces.length} parts, ${(downloaded.reduce((n, part) => n + part.body.length, 0) / 1048576).toFixed(1)} MiB` };
    });

    if (parts) {
      await step("restore in session B", async () => {
        const b = await fleet.createSession(computer, "check B");
        sessions.push(b);
        for (const part of parts.downloaded) await fleet.writeFile(computer, b, part.name, part.body);
        const goal = [
          "Restore the attached project in your working directory: `cat attachments/project.tar.part-* | tar -xf -`.",
          "Then write restored.txt with the output of `sha256sum project/data.bin` followed by the content of project/notes/林晚.md, and return restored.txt.",
        ].join("\n");
        const info = await finish(computer, b, await fleet.run(computer, b, goal, `check-${Date.now()}-restore`));
        ended(info, "completed");
        const restored = (await read(computer, b, "restored.txt")).toString();
        expect(restored.includes(parts.expected), "the restored data.bin differs from the packed one");
        expect(restored.includes("look v1"), "the note with a Chinese name didn't survive the round trip");
        return { value: true, note: `${parts.downloaded.length} parts attached, project/ restored intact` };
      });
    }

    listening.abort();
    await following;
    await step("events", async () => {
      expect(events.progress + events.activity + events.result > 0, "no events arrived from the session");
      return { value: events, note: `progress ${events.progress}, activity ${events.activity}, input ${events.input}, result ${events.result}` };
    });
  }

  await step("close sessions", async () => {
    for (const session of sessions.splice(0)) await fleet.closeSession(computer, session.name);
    return { value: true, note: "closed, work directories removed" };
  });

  // Lifecycle: stop, start again from the saved credentials, start while running, stop.
  await step("stop", async () => {
    expect(await fleet.stop(computer), "the stop didn't finish in time (it carries on at Pine)");
    const state = await fleet.status(computer);
    expect(state === "stopped", `status after stop is ${state}`);
    return { value: true, note: "stopped" };
  });

  await step("start from credentials", async () => {
    const attached = await fleet.startComputer(credentials, LABEL, IDLE_S);
    ref = { ...computer, binding: attached.binding };
    const state = await fleet.status(ref);
    expect(state === "running", `status after start is ${state}`);
    return { value: true, note: "running again, same Computer" };
  });

  await step("start while running", async () => {
    // What the engine does when it lost the binding of a Computer that is still up.
    const attached = await fleet.startComputer(credentials, LABEL, IDLE_S);
    ref = { ...computer, binding: attached.binding };
    const state = await fleet.status(ref);
    expect(state === "running", `status is ${state}`);
    return { value: true, note: "stopped by id and started again" };
  });

  await step("stop again", async () => {
    expect(await fleet.stop(ref!), "the stop didn't finish in time (it carries on at Pine)");
    ref = undefined;
    return { value: true, note: "stopped" };
  });
} catch (error) {
  failures += 1;
  console.log(`\n  ${(error as Error).message}`);
} finally {
  if (ref) {
    // Leave nothing running: by the binding, else by id.
    const left = ref;
    const stopped = await fleet.stop(left).catch(async () => {
      await new Client({ endpoint: pine.endpoint, apiKey: pine.apiKey, controlHost: pine.controlHost }).stopComputer(left.id);
      return true;
    });
    console.log(stopped ? "\n  The check's Computer is stopped." : `\n  The check's Computer ${left.id} is still stopping; it stops on its own within ${IDLE_S / 60} minutes.`);
  }
}

console.log(`\nTurns cost ${priced ? "" : "at least "}$${cost.toFixed(4)}. ${failures ? `${failures} check(s) failed.` : "Everything the studio does on Pine works on this project."}`);
process.exit(failures ? 1 : 0);
