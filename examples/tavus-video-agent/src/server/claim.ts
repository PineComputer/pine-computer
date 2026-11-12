// The claim: the PAL's three tools on one side, Pine's agent on the other. A tool call starts or answers a
// turn and returns at once; the follower waits on the turn in the background, so the work goes on after the
// call ends, and turns each question or result into a nudge the page relays into the live call.

import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NotFoundError, SandboxGoneError, type AgentTurn } from "@pinesandbox/computer";
import { TOOLS, type CaseView, type Nudge } from "@/shared/api";
import { PORTAL_EMAIL, PORTAL_URL, portalSecrets as secrets } from "./config";
import { clearSteps, publish } from "./live";
import { ensure, freshSession, session } from "./pine";
import { claimExists, portalStaff } from "./portal";
import { DATA_DIR, read, update, type ClaimCase, type Who } from "./store";


export interface ClaimRequest {
  product: string;
  issue: string;
  details?: string;
  resolution?: string;
}

/** The goal Pine's agent works toward. Its questions come back to the PAL, which asks the customer. */
export function goal(r: ClaimCase["request"]): string {
  return `You're filing a new warranty claim for a customer, Jordan Lee, in the Larkspur Care support portal: ${PORTAL_URL}
This is a new case: don't rely on files, tabs or notes from any earlier work. The portal is the only record.
Sign in with email ${PORTAL_EMAIL} and password $PORTAL_PASSWORD, and leave "Keep me signed in" checked. If you're already signed in, carry on.
If the portal asks for a verification code, ask me for it.

What the customer told us:
- Product: ${r.product}
- Problem: ${r.issue}
- More detail: ${r.details || "none"}
- Preferred resolution: ${r.resolution}

1. Under Orders, find the order for this product. Open the Larkspur Limited Warranty PDF (under Warranty policy), read the coverage period and what a claim needs, and check that this order is still covered.
2. If it isn't covered, stop and explain why in two sentences.
3. Start a warranty claim from the order. Fill in every field you can from the portal and from what the customer told us. Don't guess anything else.
4. If a required field needs information only the customer has (for example the serial number), ask me for it in one short question that says where the customer can find it.
5. When the form is complete, continue to the review page. Don't submit yet: ask me for approval in one question that lists the product, problem, resolution and return address, ending with "Shall I submit it?"
6. Only after I say yes, choose Submit claim. Open the confirmation and note the claim number and the next steps.
7. Write claim-summary.pdf in the working directory with the claim number, order number, product, serial number, problem, resolution and next steps, and return it.
Finish with two sentences that include the claim number and what the customer does next.`;
}

export function toView(c: ClaimCase | undefined): CaseView | null {
  if (!c) return null;
  const { id, state, request, question, questionKind, summary, claimNumber, verified, log, startedAt, endedAt, cost } = c;
  return { id, state, request, question, questionKind, summary, claimNumber, verified, log, startedAt, endedAt, cost, files: c.files.map(({ path: p, name, size }) => ({ path: p, name, size })) };
}

async function change(fn: (c: ClaimCase) => void): Promise<ClaimCase | undefined> {
  const c = await update((d) => {
    if (d.claim) fn(d.claim);
    return d.claim;
  });
  publish({ type: "case", claim: toView(c) });
  return c;
}

const entry = (who: Who, text: string) => ({ at: new Date().toISOString(), who, text });

// ---------- the PAL's tools ----------

/**
 * A session's agent remembers its earlier runs: a new case starts from a clean memory, or it would report
 * the last case's claim. The sign-ins belong to the Computer and stay.
 */
async function forget(s: NonNullable<Awaited<ReturnType<typeof session>>>): Promise<void> {
  try {
    const { taskId, turn } = await s.agent.status();
    if (turn) await s.agent.reset(taskId);
  } catch (error) {
    if ((error as { status?: number }).status !== 404) throw error; // 404: no task yet
  }
}

/** start_warranty_claim: starts the work and returns at once, while the Computer carries on. */
export async function startClaim(r: ClaimRequest, by: Who, key?: string): Promise<string> {
  const current = (await read()).claim;
  if (current?.state === "working") return "The claim is already being worked on. You'll get an update when the computer needs something or finishes.";
  if (current?.state === "needs_input") return `The claim is already open and waiting on the customer: ${current.question}`;
  if (current?.state === "done") return `This claim is already submitted: ${current.claimNumber ?? "see the summary"}. ${current.summary ?? ""}`;

  const request = { product: r.product.trim(), issue: r.issue.trim(), details: (r.details ?? "").trim(), resolution: /repair/i.test(r.resolution ?? "") ? "Repair" : "Replacement" };
  const { session: s } = await ensure();
  clearSteps();
  await forget(s);
  const turn = await s.agent.run(goal(request), { idempotencyKey: key ?? randomUUID(), secrets: secrets() });
  const claim: ClaimCase = {
    id: randomUUID().slice(0, 8),
    startedAt: new Date().toISOString(),
    request,
    state: "working",
    turnId: turn.turnId,
    files: [],
    cost: 0,
    log: [entry(by === "operator" ? "operator" : "pal", `Asked the computer to file a warranty claim: ${request.product}, ${request.issue.toLowerCase()}, ${request.resolution.toLowerCase()}.`)],
  };
  await update((d) => {
    d.claim = claim;
  });
  publish({ type: "case", claim: toView(claim) });
  follow();
  return "Started. The computer is signing in to the Larkspur Care portal and finding the order now. It works in the background, and you'll get an update when it needs something from the customer or when it's done.";
}

/** answer_claim_question: the customer's answer to the question the agent stopped on. */
export async function answerClaim(answer: string, by: Who): Promise<string> {
  const c = (await read()).claim;
  if (!c) return "There's no claim yet. Start one with start_warranty_claim.";
  if (c.state !== "needs_input") return `There's no open question right now. ${statusLine(c)}`;
  const s = await session();
  if (!s) {
    await change((x) => void (x.state = "stopped"));
    return "The computer was stopped, so the claim has to be started again.";
  }
  const next = await s.agent.answer(c.turnId, answer, { secrets: secrets() });
  await change((x) => {
    x.state = "working";
    x.turnId = next.turnId;
    x.log.push(entry(by === "operator" ? "operator" : "customer", answer));
    delete x.question;
    delete x.questionKind;
  });
  follow();
  return c.questionKind === "approval"
    ? "Passed on. The computer is submitting the claim now; you'll get the claim number in a moment."
    : "Passed on. The computer is carrying on with the claim; you'll get an update when it needs something else or is ready to submit.";
}

function statusLine(c: ClaimCase): string {
  switch (c.state) {
    case "working":
      return "The computer is working on the claim in the portal right now.";
    case "needs_input":
      return `The claim is waiting on the customer. The computer asked: ${c.question}`;
    case "done":
      return `The claim is submitted. ${c.summary ?? ""}`;
    case "failed":
      return `The claim task couldn't finish: ${c.summary ?? "no reason given"}.`;
    default:
      return "The claim task stopped before it finished.";
  }
}

/** get_claim_status */
export async function claimStatus(): Promise<string> {
  const c = (await read()).claim;
  return c ? statusLine(c) : "There's no claim yet.";
}

export async function resetClaim(): Promise<void> {
  const c = (await read()).claim;
  if (c && (c.state === "working" || c.state === "needs_input")) {
    const s = await session();
    await s?.agent.cancel(c.turnId).catch(() => undefined);
  }
  await update((d) => {
    delete d.claim;
    d.conversations = [];
  });
  clearSteps();
  publish({ type: "case", claim: null });
  // The last case's tabs and files would read as this one's history: start the next in a new session.
  await freshSession();
}

// ---------- nudges: what the live call should hear ----------

// Tavus drops bracketed text from a respond, so the tag is plain words the PAL is told to recognise.
const TAG = "Claim task update, from the computer, not the customer:";

function nudgeFor(c: ClaimCase): Nudge | null {
  if (c.state === "needs_input" && c.questionKind === "approval")
    return {
      id: `${c.turnId}:approval`,
      kind: "question",
      context: `CLAIM TASK UPDATE: the claim is filled in and waiting on the portal's review page, not submitted. The computer asks: "${c.question}" Read the key details back in one sentence, get a clear yes or no from the customer, then call ${TOOLS.answer} with what they said.`,
      prompt: `${TAG} The claim is ready to submit. Summarise it in one sentence and ask the customer to confirm.`,
    };
  if (c.state === "needs_input")
    return {
      id: `${c.turnId}:question`,
      kind: "question",
      context: `CLAIM TASK UPDATE: the computer is waiting on the customer. Its question: "${c.question}" Ask the customer for this in your own words, then call ${TOOLS.answer} with their answer. Never make up an answer.`,
      prompt: `${TAG} It needs one thing from the customer: ${c.question} Ask them for it now, briefly.`,
    };
  if (c.state === "done")
    return {
      id: `${c.turnId}:done`,
      kind: "done",
      context: `CLAIM TASK UPDATE: done. ${c.summary ?? ""} Claim number: ${c.claimNumber ?? "see summary"}. A claim summary PDF is in the customer's case files.`,
      prompt: `${TAG} The claim is submitted: ${c.summary ?? ""} Tell the customer the claim number and what happens next.`,
    };
  if (c.state === "failed")
    return {
      id: `${c.turnId}:failed`,
      kind: "failed",
      context: `CLAIM TASK UPDATE: the claim task stopped without finishing: ${c.summary ?? "no reason given"}.`,
      prompt: `${TAG} The claim task couldn't finish: ${c.summary ?? "no reason given"} Tell the customer plainly and offer to have a person follow up.`,
    };
  return null;
}

/** The nudge for the case as it stands, for a page that joins mid-case. */
export async function currentNudge(): Promise<Nudge | null> {
  const c = (await read()).claim;
  return c ? nudgeFor(c) : null;
}

// ---------- the follower ----------

const shared = globalThis as typeof globalThis & { __demoFollowing?: boolean };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Waits on the case's turn until it asks, ends or the Computer goes; one loop per process. */
export function follow(): void {
  if (shared.__demoFollowing) return;
  shared.__demoFollowing = true;
  loop()
    .catch((error) => console.error("[claim] follower stopped:", error))
    .finally(() => {
      shared.__demoFollowing = false;
    });
}

async function loop(): Promise<void> {
  for (;;) {
    const c = (await read()).claim;
    if (!c || c.state !== "working") return;
    const s = await session();
    if (!s) {
      await change((x) => void (x.state = "stopped"));
      return;
    }
    let turn: AgentTurn;
    try {
      turn = await s.agent.wait(c.turnId, { timeoutMs: 25_000 });
    } catch (error) {
      if (error instanceof SandboxGoneError || error instanceof NotFoundError) {
        await change((x) => void (x.state = "stopped"));
        return;
      }
      console.error("[claim] wait failed, retrying:", error);
      await sleep(3_000);
      continue;
    }
    if (turn.state === "running" || turn.state === "canceling") continue;
    if (turn.state === "answered") {
      await change((x) => void (x.turnId = turn.nextTurnId));
      continue;
    }
    await settle(c, turn, s);
  }
}

/** The agent writes Markdown; the PAL speaks. Links become their words, emphasis goes. */
const plain = (text: string) =>
  text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`]+/g, "")
    .replace(/\s+/g, " ")
    .trim();

async function settle(c: ClaimCase, turn: AgentTurn, s: NonNullable<Awaited<ReturnType<typeof session>>>): Promise<void> {
  const cost = turn.result?.usage.cost.total ?? 0;
  if (turn.state === "needs_input") {
    const question = plain(turn.question || turn.result?.summary || "The computer needs more information.");
    const kind = /\bsubmit\b/i.test(question) ? "approval" : "info";
    const after = await change((x) => {
      x.state = "needs_input";
      x.question = question;
      x.questionKind = kind;
      x.cost += cost;
      x.log.push(entry("computer", question));
    });
    const n = after && nudgeFor(after);
    if (n) publish({ type: "nudge", nudge: n });
    return;
  }
  const summary = plain(turn.result?.summary ?? "");
  const files: ClaimCase["files"] = [];
  if (turn.state === "completed") {
    const dir = path.join(DATA_DIR, "files", c.id);
    await mkdir(dir, { recursive: true });
    for (const a of turn.result?.artifacts ?? []) {
      try {
        const bytes = await s.readFile(a.relativePath);
        const name = path.basename(a.relativePath);
        await writeFile(path.join(dir, name), bytes);
        files.push({ path: `${c.id}/${name}`, name, size: bytes.byteLength, contentType: name.endsWith(".pdf") ? "application/pdf" : "application/octet-stream" });
      } catch (error) {
        console.error("[claim] couldn't copy", a.relativePath, error);
      }
    }
  }
  const number = summary.match(/LC-\d{6}/)?.[0];
  const verified = !!number && (await claimExists(number).catch(() => false));
  // A claim the portal has no record of isn't a result: the PAL says so instead of reading out the number.
  const unconfirmed = turn.state === "completed" && portalStaff() && !verified;
  const after = await change((x) => {
    x.state = turn.state === "completed" && !unconfirmed ? "done" : "failed";
    x.summary = summary || (turn.state === "completed" ? "Done." : `The turn ended: ${turn.state}.`);
    x.claimNumber = unconfirmed ? undefined : number;
    x.verified = verified;
    x.files = unconfirmed ? [] : files;
    x.cost += cost;
    x.endedAt = new Date().toISOString();
    x.log.push(entry("computer", x.summary));
    if (verified) x.log.push(entry("check", `Checked in Larkspur Care's records: claim ${number} exists.`));
    if (unconfirmed) {
      x.summary = number ? `The computer reported claim ${number}, but Larkspur Care has no record of it.` : "The computer finished without a claim number Larkspur Care has on record.";
      x.log.push(entry("check", x.summary));
    }
  });
  const n = after && nudgeFor(after);
  if (n) publish({ type: "nudge", nudge: n });
}
