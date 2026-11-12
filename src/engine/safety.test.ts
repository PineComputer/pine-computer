// What keeps the studio safe to leave running: who may call its API, how returned files are
// served, and that work and Computers stay where the maker put them, through failures.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const DATA = mkdtempSync(path.join(tmpdir(), "studio-safety-"));
process.env.STUDIO_DATA_DIR = DATA;
process.env.STUDIO_REPLAY_SPEED = "40";
process.env.STUDIO_TOKEN = "test-token";
process.env.STUDIO_SECRET = Buffer.alloc(32, 9).toString("base64");

type Modules = {
  db: typeof import("./db.ts");
  computers: typeof import("./computers.ts");
  scheduler: typeof import("./scheduler.ts");
  dramas: typeof import("./dramas.ts");
  library: typeof import("./library.ts");
  replay: typeof import("./replay-fleet.ts");
  http: typeof import("./http.ts");
  views: typeof import("./views.ts");
  flow: typeof import("./flow.ts");
};
let m: Modules;

const HOST = "127.0.0.1:4310";
const SIGNED_IN = { host: HOST, origin: `http://${HOST}`, cookie: "studio=test-token" };

function request(method: string, url: string, headers: Record<string, string>, body?: string) {
  return m.http.app().fetch(new Request(`http://${HOST}${url}`, { method, headers, body }));
}

async function until<T>(what: string, probe: () => T | undefined, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = probe();
    if (found) return found;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

const screenplay = { name: "screenplay.txt", type: "text/plain", bytes: new TextEncoder().encode("EPISODE 1\nLin enters.") };
const newDrama = (title: string) => ({ title, language: "en", format: "", parallel: 1, perComputer: 1, notes: "", files: [screenplay], preset: "en-us-live-sfw", screenplayLanguage: "en", screenplay: 0 });
/** Ends the earlier tests' dramas and Computers, so a test's own drama has the line to itself. */
function quiet() {
  m.db.run("update dramas set status = 'done' where status in ('setup', 'production')");
  m.db.run("update computers set state = 'stopped', binding = null where state in ('starting', 'running', 'stopping', 'failed')");
}

const computersOf = (dramaId: string) => m.db.all<{ id: string; state: string; failures: number }>("select * from computers where drama_id = ? order by created_at", dramaId);

beforeAll(async () => {
  m = {
    db: await import("./db.ts"),
    computers: await import("./computers.ts"),
    scheduler: await import("./scheduler.ts"),
    dramas: await import("./dramas.ts"),
    library: await import("./library.ts"),
    replay: await import("./replay-fleet.ts"),
    http: await import("./http.ts"),
    views: await import("./views.ts"),
    flow: await import("./flow.ts"),
  };
  m.db.db();
});

afterAll(() => {
  m.scheduler.stopClock();
  rmSync(DATA, { recursive: true, force: true });
});

describe("the API", () => {
  it("answers only the studio's own window", async () => {
    expect((await request("GET", "/api/dramas", { host: HOST })).status).toBe(401);
    expect((await request("GET", "/api/dramas", { host: HOST, cookie: "studio=guess" })).status).toBe(401);
    expect((await request("GET", "/api/dramas", SIGNED_IN)).status).toBe(200);
    const foreign = await request("POST", "/api/connection/replay", { ...SIGNED_IN, origin: "http://localhost:3000" });
    expect(foreign.status).toBe(403);
    expect((await request("GET", "/api/dramas", { host: "studio.example.com", cookie: "studio=test-token" })).status).toBe(404);
  });

  it("lets a window in through the printed link", async () => {
    const opened = await request("GET", "/api/open?ticket=test-token", { host: HOST });
    expect(opened.status).toBe(302);
    expect(opened.headers.get("set-cookie")).toMatch(/^studio=test-token;.*HttpOnly/);
    expect((await request("GET", "/api/open?ticket=old", { host: HOST })).status).toBe(403);
  });

  it("serves returned files so they can't act as the studio's pages", async () => {
    const page = await m.library.save(new TextEncoder().encode("<script>fetch('/api/dramas')</script>"), { dramaId: "d", relPath: "out/page.html", type: "text/html" });
    const picture = await m.library.save(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"), { dramaId: "d", relPath: "out/a.svg", type: "image/svg+xml" });
    const html = await request("GET", `/api/files/${page}`, SIGNED_IN);
    expect(html.headers.get("content-type")).toBe("application/octet-stream");
    expect(html.headers.get("content-disposition")).toMatch(/^attachment/);
    const svg = await request("GET", `/api/files/${picture}`, SIGNED_IN);
    expect(svg.headers.get("content-disposition")).toBeNull();
    expect(svg.headers.get("content-security-policy")).toMatch(/^sandbox/);
    expect(svg.headers.get("x-content-type-options")).toBe("nosniff");
  });
});

describe("the production line", () => {
  it("never runs a drama made in the other mode", async () => {
    m.computers.setFleet(new m.replay.ReplayFleet());
    m.scheduler.startClock(20);
    const pineDrama = await m.dramas.createDrama(newDrama("Made on Pine"), "pine");
    const replayDrama = await m.dramas.createDrama(newDrama("Made in replay"), "replay");
    await until("the replay drama's Computer", () => computersOf(replayDrama).find((row) => row.state === "running"));
    expect(computersOf(pineDrama)).toHaveLength(0);
    m.scheduler.stopClock();
  });

  it("retries a failed Create as the same Computer, then waits for the maker", async () => {
    const fleet = new m.replay.ReplayFleet();
    const create = fleet.createComputer.bind(fleet);
    let refusals = 3;
    fleet.createComputer = async (...args) => {
      if (refusals-- > 0) throw new Error("Create answered nothing");
      return create(...args);
    };
    const start = fleet.startComputer.bind(fleet);
    fleet.startComputer = async (...args) => {
      if (refusals-- > 0) throw new Error("Start answered nothing");
      return start(...args);
    };
    m.computers.setFleet(fleet);
    m.scheduler.startClock(20);
    const id = await m.dramas.createDrama(newDrama("Flaky"), "replay");
    const failed = await until("the failed start", () => computersOf(id).find((row) => row.state === "failed"));
    // No new identity while the first one can still be started; after enough failures, the line waits.
    m.db.run("update computers set failures = ?, updated_at = ? where id = ?", m.computers.START_ATTEMPTS, new Date(0).toISOString(), failed.id);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(computersOf(id)).toHaveLength(1);
    expect(computersOf(id)[0].state).toBe("failed");
    refusals = 0;
    m.computers.retryStarts(id);
    await until("the same Computer running", () => computersOf(id).find((row) => row.state === "running"));
    expect(computersOf(id).map((row) => row.id)).toEqual([failed.id]);
    m.scheduler.stopClock();
  });

  it("keeps within the project's limits: Computers at once, and idle time", async () => {
    const fleet = new m.replay.ReplayFleet();
    let reads = 0;
    fleet.limits = async () => {
      reads += 1;
      return { maxComputers: 1, maxIdleSeconds: 1800, idleAdjustable: true, maxRuntimeSeconds: null };
    };
    quiet();
    m.computers.setFleet(fleet);
    await m.computers.freshLimits();
    m.scheduler.startClock(20);
    const first = await m.dramas.createDrama(newDrama("First in line"), "replay");
    const second = await m.dramas.createDrama(newDrama("Second in line"), "replay");
    const running = await until("one Computer", () => [...computersOf(first), ...computersOf(second)].find((row) => row.state === "running"));
    await new Promise((resolve) => setTimeout(resolve, 300));
    const live = m.db.all<{ id: string; idle_timeout: number }>("select * from computers where drama_id in (?, ?) and state in ('starting', 'running')", first, second);
    expect(live.map((row) => row.id)).toEqual([running.id]);
    expect(live[0].idle_timeout).toBe(1800);
    const waiting = m.views.dramaView(m.db.get("select * from dramas where id = ?", computersOf(first).length ? second : first)!);
    expect(waiting.atLimit).toBe(1);
    // Read once on connecting: not again for the start, the reconcile, or the work waiting at the limit.
    await m.scheduler.reconcile();
    expect(reads).toBe(1);
    // Ten minutes on, the waiting work reads the limit again, once.
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() + 11 * 60_000);
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(reads).toBe(2);
    } finally {
      vi.useRealTimers();
    }
    m.scheduler.stopClock();
  });

  it("waits out a busy project without counting it as a failure", async () => {
    const fleet = new m.replay.ReplayFleet();
    const create = fleet.createComputer.bind(fleet);
    let busy = 1;
    fleet.createComputer = async (...args) => {
      if (busy-- > 0) throw Object.assign(new Error("The project runs as many Computers as it may."), { retryLater: true });
      return create(...args);
    };
    quiet();
    m.computers.setFleet(fleet);
    m.scheduler.startClock(20);
    const id = await m.dramas.createDrama(newDrama("Busy project"), "replay");
    const waited = await until("the busy start", () => computersOf(id).find((row) => row.state === "failed"));
    expect(waited.failures).toBe(0);
    m.db.run("update computers set updated_at = ? where id = ?", new Date(0).toISOString(), waited.id);
    await until("the same Computer running", () => computersOf(id).find((row) => row.state === "running"));
    expect(computersOf(id).map((row) => row.id)).toEqual([waited.id]);
    m.scheduler.stopClock();
  });

  it("holds a drama whose project doesn't offer the drama skill, before any run", async () => {
    const fleet = new m.replay.ReplayFleet();
    fleet.skills = async () => ["pdf", "docx"];
    quiet();
    m.computers.setFleet(fleet);
    m.scheduler.startClock(20);
    const id = await m.dramas.createDrama(newDrama("No skill"), "replay");
    const held = await until("the hold", () => m.db.get<{ status: string; reason: string }>("select * from dramas where id = ? and status = 'stopped'", id));
    expect(held.reason).toBe("no-drama-skill");
    expect(m.db.all("select r.key from runs r join sessions s on s.id = r.session_id where s.drama_id = ?", id)).toHaveLength(0);
    expect(m.db.all("select id from sessions where drama_id = ? and state = 'open'", id)).toHaveLength(0);
    m.scheduler.stopClock();
  });

  it("rehearses a held drama with the stand-in kit, and remembers the project lacks the skill", async () => {
    const fleet = new m.replay.ReplayFleet();
    fleet.skills = async () => ["pdf"];
    const kits: string[] = [];
    const write = fleet.writeFile.bind(fleet);
    fleet.writeFile = async (ref, session, name, content) => {
      if (name === "standin.py") kits.push(session.name);
      return write(ref, session, name, content);
    };
    quiet();
    m.computers.setFleet(fleet);
    m.scheduler.startClock(20);
    const id = await m.dramas.createDrama(newDrama("Rehearsed"), "replay");
    await until("the hold", () => m.db.get("select * from dramas where id = ? and status = 'stopped'", id));
    expect((await import("./settings.ts")).dramaSkill(fleet.project)).toBe("missing");
    m.dramas.rehearse(id);
    const setup = await until("the rehearsed setup run", () => m.db.get<{ goal: string }>("select r.goal from runs r join sessions s on s.id = r.session_id where s.drama_id = ? and r.kind = 'setup'", id));
    expect(setup.goal).toMatch(/^This is a rehearsal/);
    expect(setup.goal).toContain("vertical short drama from my screenplay");
    expect(kits).toHaveLength(1);
    expect(m.db.get<{ status: string; rehearsal: number }>("select * from dramas where id = ?", id)).toMatchObject({ status: "setup", rehearsal: 1 });
    expect(() => m.dramas.rehearse(id)).toThrow(/held/);
    m.scheduler.stopClock();
  });

  it("holds a drama made before New drama asked for drama-cli init's inputs, and starts once the maker chooses them", async () => {
    const fleet = new m.replay.ReplayFleet();
    quiet();
    m.computers.setFleet(fleet);
    const id = await m.dramas.createDrama(newDrama("Made before"), "replay");
    // As a drama made before: no preset, screenplay language or screenplay chosen.
    m.db.run("update dramas set preset = '', screenplay_language = '', screenplay_file = null where id = ?", id);
    m.scheduler.startClock(20);
    const held = await until("the hold", () => m.db.get<{ reason: string }>("select * from dramas where id = ? and status = 'stopped'", id));
    expect(held.reason).toBe("choose-inputs");
    const file = m.db.get<{ id: number }>("select f.id from files f join inputs i on i.file_id = f.id where i.drama_id = ? and f.kind = 'screenplay'", id)!;
    await expect(m.dramas.chooseInputs(id, { preset: "zh-cn-live-sfw", screenplayLanguage: "zh", screenplay: 0 })).rejects.toThrow(/which file is the screenplay/);
    // Only the presets the studio names are offered: an adult preset drama-cli bundles is not.
    await expect(m.dramas.chooseInputs(id, { preset: "customer-xxcited", screenplayLanguage: "zh", screenplay: file.id })).rejects.toThrow(/no preset customer-xxcited/);
    await m.dramas.chooseInputs(id, { preset: "zh-cn-live-sfw", screenplayLanguage: "zh", screenplay: file.id });
    const setup = await until("the setup run", () => m.db.get<{ goal: string }>("select r.goal from runs r join sessions s on s.id = r.session_id where s.drama_id = ? and r.kind = 'setup'", id));
    expect(setup.goal).toContain("drama-cli init drama --preset zh-cn-live-sfw --inputs.screenplay drama/inputs/screenplay.txt --inputs.brief drama/inputs/brief.md --screenplay-language zh");
    m.scheduler.stopClock();
  });

  it("asks a drama made before brief.md for its episode length, writes the brief and starts, never holding it again", async () => {
    const fleet = new m.replay.ReplayFleet();
    quiet();
    m.computers.setFleet(fleet);
    const id = await m.dramas.createDrama({ ...newDrama("No brief yet"), notes: "Slow burn." }, "replay");
    // As a drama made before the studio wrote brief.md: no brief, no length, no inputs chosen.
    m.db.run("delete from inputs where drama_id = ? and file_id in (select id from files where drama_id = ? and kind = 'brief')", id, id);
    m.db.run("update dramas set preset = '', screenplay_language = '', screenplay_file = null, length = '' where id = ?", id);
    m.scheduler.startClock(20);
    await until("the hold", () => m.db.get("select * from dramas where id = ? and status = 'stopped' and reason = 'choose-inputs'", id));
    const file = m.db.get<{ id: number }>("select f.id from files f join inputs i on i.file_id = f.id where i.drama_id = ? and f.kind = 'screenplay'", id)!;
    const choice = { preset: "en-us-live-sfw", screenplayLanguage: "en", screenplay: file.id };
    await expect(m.dramas.chooseInputs(id, choice)).rejects.toThrow(/episode length/);
    await m.dramas.chooseInputs(id, { ...choice, length: "90" });
    const setup = await until("the setup run", () => m.db.get<{ goal: string }>("select r.goal from runs r join sessions s on s.id = r.session_id where s.drama_id = ? and r.kind = 'setup'", id));
    expect(setup.goal).toContain("--inputs.brief drama/inputs/brief.md");
    const brief = m.db.get<{ sha: string }>("select f.sha from files f join inputs i on i.file_id = f.id where i.drama_id = ? and f.kind = 'brief'", id)!;
    expect((await import("node:fs")).readFileSync(m.library.blobPath(brief.sha), "utf8")).toBe("Title: No brief yet\nEpisode length: about a minute and a half (80 to 110 seconds).\n\nNotes: Slow burn.\n");
    m.scheduler.stopClock();
  });

  it("takes the screenplay the maker marked by its place among the files, even when two share a name", async () => {
    quiet();
    const first = { name: "story.txt", type: "text/plain", bytes: new TextEncoder().encode("EPISODE 1\nThe first draft.") };
    const second = { name: "story.txt", type: "text/plain", bytes: new TextEncoder().encode("EPISODE 1\nThe second draft.") };
    const id = await m.dramas.createDrama({ ...newDrama("Two stories"), files: [first, second], screenplay: 1 }, "replay");
    const chosen = m.db.get<{ sha: string }>("select f.sha from files f join dramas d on d.screenplay_file = f.id where d.id = ?", id)!;
    expect((await import("node:fs")).readFileSync(m.library.blobPath(chosen.sha), "utf8")).toBe("EPISODE 1\nThe second draft.");
    await expect(m.dramas.createDrama({ ...newDrama("Out of range"), screenplay: 2 }, "replay")).rejects.toThrow(/which file is the screenplay/);
  });

  it("writes brief.md from New drama, opening with the two lines drama-cli init asks for", async () => {
    quiet();
    const id = await m.dramas.createDrama({ ...newDrama("The Night It Rained"), notes: "Fast and cruel." }, "replay");
    const brief = m.db.get<{ sha: string }>("select f.sha from files f join inputs i on i.file_id = f.id where i.drama_id = ? and f.kind = 'brief'", id)!;
    const text = (await import("node:fs")).readFileSync(m.library.blobPath(brief.sha), "utf8");
    expect(text).toBe("Title: The Night It Rained\nEpisode length: about a minute (50 to 70 seconds).\n\nNotes: Fast and cruel.\n");
    await expect(m.dramas.createDrama({ ...newDrama("No screenplay marked"), screenplay: -1 }, "replay")).rejects.toThrow(/which file is the screenplay/);
    await expect(m.dramas.createDrama({ ...newDrama("No language"), screenplayLanguage: "" }, "replay")).rejects.toThrow(/screenplay's language/);
    await expect(m.dramas.createDrama({ ...newDrama("No preset"), preset: "" }, "replay")).rejects.toThrow(/Choose a preset/);
    await expect(m.dramas.createDrama({ ...newDrama("Adult preset"), preset: "customer-xxcited" }, "replay")).rejects.toThrow(/no preset customer-xxcited/);
  });

  it("holds a drama in production whose project lost the drama skill, before the next episode runs", async () => {
    const fleet = new m.replay.ReplayFleet();
    fleet.skills = async () => [];
    quiet();
    m.computers.setFleet(fleet);
    const id = await m.dramas.createDrama(newDrama("Lost skill"), "replay");
    m.db.run("update dramas set status = 'production' where id = ?", id);
    m.db.run("insert into episodes (id, drama_id, number, title, state, updated_at) values ('ep-lost', ?, 1, 'One', 'queued', ?)", id, new Date().toISOString());
    m.scheduler.startClock(20);
    const held = await until("the hold", () => m.db.get<{ reason: string }>("select * from dramas where id = ? and status = 'stopped'", id));
    expect(held.reason).toBe("no-drama-skill");
    expect(m.db.get<{ state: string }>("select state from episodes where id = 'ep-lost'")?.state).toBe("queued");
    expect(m.db.all("select r.key from runs r join sessions s on s.id = r.session_id where s.drama_id = ?", id)).toHaveLength(0);
    m.scheduler.stopClock();
  });

  it("asks the maker, rather than failing, when an agent keeps finishing short of a review", async () => {
    quiet();
    m.computers.setFleet(new m.replay.ReplayFleet());
    const id = await m.dramas.createDrama(newDrama("Finishing short"), "replay");
    const at = new Date().toISOString();
    m.db.run("update dramas set status = 'production' where id = ?", id);
    m.db.run("insert into sessions (id, computer_id, drama_id, name, role, episode_id, state, created_at) values ('ses-short', 'pc-none', ?, 'short', 'episode', 'ep-short', 'open', ?)", id, at);
    m.db.run("insert into episodes (id, drama_id, number, title, state, session_id, continues, updated_at) values ('ep-short', ?, 1, 'One', 'working', 'ses-short', 2, ?)", id, at);
    m.db.run("insert into turns (id, session_id, state, summary, settled, files_saved, created_at, ended_at) values ('turn-short', 'ses-short', 'completed', 'Waiting on your go-ahead for the storyboards.', 1, 1, ?, ?)", at, at);
    const session = m.db.get<import("./records.ts").SessionRow>("select * from sessions where id = 'ses-short'")!;
    const info = { turnId: "turn-short", state: "completed", question: "", summary: "Waiting on your go-ahead for the storyboards.", nextTurnId: "", files: [], cost: null, media: null };
    expect(m.flow.stopsForMaker(session, info)).toBe(false);
    await m.flow.onEnded(session, info, false);
    expect(m.db.get("select kind, state from reviews where turn_id = 'turn-short'")).toMatchObject({ kind: "question", state: "open" });
    expect(m.db.get<{ state: string }>("select state from episodes where id = 'ep-short'")?.state).toBe("waiting");
    // Said in so many words, it is a stop from the start.
    expect(m.flow.stopsForMaker(session, { ...info, summary: "The storyboards are packed.\n\nPlease reply with approval or changes." })).toBe(true);
    expect(m.flow.stopsForMaker(session, { ...info, summary: "分镜已完成。\n\n请审阅后回复。" })).toBe(true);
    // With a cut, the maker can call the episode finished instead; Delivery hands over that cut.
    await expect(m.dramas.finishEpisode("ep-short")).rejects.toThrow(/no cut/);
    m.db.run("insert into files (drama_id, episode_id, session_id, turn_id, sha, rel_path, name, type, size, kind, version, created_at) values (?, 'ep-short', 'ses-short', 'turn-short', 'ab', 'drama/episodes/EP001/edit/v1/cut.mp4', 'cut.mp4', 'video/mp4', 1, 'cut', 'v1', ?)", id, at);
    await m.dramas.finishEpisode("ep-short");
    expect(m.db.get<{ state: string }>("select state from episodes where id = 'ep-short'")?.state).toBe("done");
    expect(m.db.get<{ state: string }>("select state from reviews where turn_id = 'turn-short'")?.state).toBe("answered");
    expect(m.db.get<{ state: string }>("select state from sessions where id = 'ses-short'")?.state).toBe("closed");
    expect((await import("./browse.ts")).deliveryRows(id)[0].accepted?.path).toBe("drama/episodes/EP001/edit/v1/cut.mp4");
  });

  it("follows the turn an answer opened when the engine stopped before recording it", async () => {
    const fleet = new m.replay.ReplayFleet();
    quiet();
    m.computers.setFleet(fleet);
    m.scheduler.startClock(20);
    const id = await m.dramas.createDrama(newDrama("Answered, unrecorded"), "replay");
    const asked = await until("the setup question", () => m.db.get<{ turn_id: string; session_id: string }>("select * from reviews where drama_id = ? and state = 'open'", id));
    m.scheduler.stopClock();
    // Pine took the answer; the engine stopped before saving the turn it opened.
    const session = m.db.get<import("./records.ts").SessionRow>("select * from sessions where id = ?", asked.session_id)!;
    const computer = m.db.get<import("./records.ts").ComputerRow>("select * from computers where id = ?", session.computer_id)!;
    const next = await fleet.answer(m.computers.computerRef(computer), m.computers.sessionRef(session), asked.turn_id, "He is 32.");
    m.db.run("update turns set state = 'answered', next_turn_id = ? where id = ?", next.turnId, asked.turn_id);
    m.db.run("update reviews set state = 'answered' where turn_id = ?", asked.turn_id);
    await m.scheduler.reconcile();
    await until("the opened turn, followed to its end", () => m.db.get("select id from turns where id = ? and ended_at is not null", next.turnId));
  });

  it("starts again an episode whose start was cut short before its run", async () => {
    quiet();
    m.computers.setFleet(new m.replay.ReplayFleet());
    const id = await m.dramas.createDrama(newDrama("Cut short"), "replay");
    // As the engine left it when it stopped mid-start: a session opened for the episode, no run sent.
    const at = new Date().toISOString();
    m.db.run("update dramas set status = 'production' where id = ?", id);
    m.db.run("insert into sessions (id, computer_id, drama_id, name, role, episode_id, state, created_at) values ('ses-cut', 'pc-gone', ?, 'cut', 'episode', 'ep-cut', 'open', ?)", id, at);
    m.db.run("insert into episodes (id, drama_id, number, title, state, session_id, updated_at) values ('ep-cut', ?, 1, 'One', 'working', 'ses-cut', ?)", id, at);
    m.scheduler.startClock(20);
    await until("its run, in a new session", () => m.db.get("select r.key from runs r join sessions s on s.id = r.session_id where s.episode_id = 'ep-cut'"));
    expect(m.db.get<{ state: string }>("select state from sessions where id = 'ses-cut'")?.state).toBe("closed");
    m.scheduler.stopClock();
  });

  it("asks for the longer idle timeout at start where it can't be changed later", async () => {
    const fleet = new m.replay.ReplayFleet();
    fleet.limits = async () => ({ maxComputers: null, maxIdleSeconds: null, idleAdjustable: false, maxRuntimeSeconds: null });
    let changes = 0;
    fleet.setIdleTimeout = async (_ref, seconds) => {
      changes += 1;
      return seconds;
    };
    quiet();
    m.computers.setFleet(fleet);
    m.scheduler.startClock(20);
    const id = await m.dramas.createDrama(newDrama("Fixed idle"), "replay");
    const computer = await until("its Computer", () => m.db.get<{ idle_timeout: number }>("select * from computers where drama_id = ? and state = 'running'", id));
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(computer.idle_timeout).toBe(3 * 60 * 60);
    expect(changes).toBe(0);
    m.scheduler.stopClock();
  });

  it("never starts a Computer made in another project", async () => {
    const before = new m.replay.ReplayFleet();
    Object.defineProperty(before, "project", { value: "project-a" });
    quiet();
    m.computers.setFleet(before);
    m.scheduler.startClock(20);
    const id = await m.dramas.createDrama(newDrama("Switched projects"), "replay");
    const first = await until("its Computer", () => computersOf(id).find((row) => row.state === "running"));
    m.scheduler.stopClock();
    const after = new m.replay.ReplayFleet();
    Object.defineProperty(after, "project", { value: "project-b" });
    let restarts = 0;
    const start = after.startComputer.bind(after);
    after.startComputer = async (credentials, ...rest) => {
      if (credentials.includes(first.id)) restarts += 1;
      return start(credentials, ...rest);
    };
    m.computers.setFleet(after);
    expect(computersOf(id).find((row) => row.id === first.id)?.state).toBe("stopped");
    m.scheduler.startClock(20);
    await until("a Computer of the new project", () => computersOf(id).find((row) => row.id !== first.id && row.state === "running"));
    expect(restarts).toBe(0);
    m.scheduler.stopClock();
  });

  it("gives no new session to a Computer near the end of its running time, and starts it afresh", async () => {
    const fleet = new m.replay.ReplayFleet();
    let starts = 0;
    const start = fleet.startComputer.bind(fleet);
    fleet.startComputer = async (...args) => {
      starts += 1;
      return start(...args);
    };
    // The project limits each start to a week: the first has an hour left; a fresh one, the week.
    fleet.limits = async () => ({ maxComputers: null, maxIdleSeconds: null, idleAdjustable: true, maxRuntimeSeconds: 7 * 24 * 3_600 });
    fleet.stopBy = async () => new Date(Date.now() + (starts === 1 ? 60 * 60_000 : 7 * 24 * 3_600_000));
    let stops = 0;
    const stopComputer = fleet.stop.bind(fleet);
    fleet.stop = async (ref) => {
      stops += 1;
      return stopComputer(ref);
    };
    quiet();
    m.computers.setFleet(fleet);
    m.scheduler.startClock(20);
    const id = await m.dramas.createDrama(newDrama("Near its limit"), "replay");
    const session = await until("the setup session", () => m.db.get<{ computer_id: string }>("select * from sessions where drama_id = ? and role = 'setup'", id));
    expect(stops).toBe(1);
    expect(starts).toBe(2);
    expect(computersOf(id).map((row) => row.id)).toEqual([session.computer_id]);
    m.scheduler.stopClock();
  });

  it("carries on in the same session after a turn breaks off", async () => {
    const fleet = new m.replay.ReplayFleet();
    const wait = fleet.wait.bind(fleet);
    let broken = false;
    fleet.wait = async (...args) => {
      const info = await wait(...args);
      if (broken) return info;
      broken = true;
      return { ...info, state: "failed", summary: "The Computer's services restarted." };
    };
    quiet();
    m.computers.setFleet(fleet);
    m.scheduler.startClock(20);
    const id = await m.dramas.createDrama(newDrama("Broken off"), "replay");
    const resent = await until("the continue run", () =>
      m.db.get<{ session_id: string; goal: string }>("select r.* from runs r join sessions s on s.id = r.session_id where s.drama_id = ? and r.kind = 'continue'", id),
    );
    expect(resent.goal).toMatch(/broke off/);
    expect(m.db.get<{ state: string }>("select state from sessions where id = ?", resent.session_id)?.state).toBe("open");
    expect(m.db.get<{ status: string }>("select status from dramas where id = ?", id)?.status).toBe("setup");
    m.scheduler.stopClock();
  });

  it("keeps the project connected while a Computer won't stop", async () => {
    const fleet = new m.replay.ReplayFleet();
    Object.defineProperty(fleet, "mode", { value: "pine" });
    fleet.stop = async () => {
      throw new Error("stop refused");
    };
    m.computers.setFleet(fleet);
    m.scheduler.startClock(20);
    const id = await m.dramas.createDrama(newDrama("Stubborn"), "pine");
    const computer = await until("its Computer", () => computersOf(id).find((row) => row.state === "running"));
    m.scheduler.stopClock();
    const response = await request("DELETE", "/api/connection", SIGNED_IN);
    expect(response.status).toBe(502);
    expect(((await response.json()) as { code: string }).code).toBe("stop-failed");
    expect(computersOf(id).find((row) => row.id === computer.id)?.state).toBe("running");
    expect(m.computers.hasFleet()).toBe(true);
  });
});

describe("diagnostics", () => {
  it("carry the studio's state and log, and nothing sealed", async () => {
    (await import("./log.ts")).keepLog("engine");
    console.warn("diagnostics: a line for the log");
    const response = await request("GET", "/api/diagnostics", SIGNED_IN);
    expect(response.headers.get("content-disposition")).toMatch(/^attachment; filename="pine-drama-diagnostics-/);
    const text = await response.text();
    const body = JSON.parse(text) as { computers: Record<string, unknown>[]; sessions: unknown[]; logs: { engine: string[]; desktop: string[] } };
    expect(body.computers.length).toBeGreaterThan(0);
    expect(body.sessions.length).toBeGreaterThan(0);
    expect(body.logs.engine.some((line) => line.endsWith("warn diagnostics: a line for the log"))).toBe(true);
    // Sealed values never leave: a Computer's credentials and binding, a session's token.
    const sealed = [
      ...m.db.all<{ credentials: string; binding: string | null }>("select credentials, binding from computers").flatMap((row) => [row.credentials, row.binding]),
      ...m.db.all<{ token: string | null }>("select token from sessions").map((row) => row.token),
    ].filter((value): value is string => Boolean(value));
    expect(sealed.length).toBeGreaterThan(0);
    for (const value of sealed) expect(text.includes(value)).toBe(false);
    expect(Object.keys(body.computers[0])).not.toContain("credentials");
  });
});
