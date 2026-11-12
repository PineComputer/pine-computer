// A process dies after it has sent a job and before it has recorded the turn. The next process must find
// that same turn, not start the job a second time. This sends a job the way the dead process would have,
// leaves the thread holding only what was written down before sending, and resumes it. Runs a real job.
//
//   npm run build && node scripts/recover-smoke.mjs

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ensureComputer, openSession } from "../dist/core/computer.js";
import { loadEnv } from "../dist/core/home.js";
import { newThread, readThread, resume, saveThread } from "../dist/core/thread.js";

loadEnv();
const COMPUTER = process.env.PINE_COMPUTER || "default";
const goal = "Open https://example.com and tell me the page's title.";
const key = randomUUID();

const thread = { ...newThread(COMPUTER), title: "recover smoke" };
const computer = await ensureComputer(COMPUTER, (step) => console.log("·", step));
const { session, fresh } = await openSession(computer, COMPUTER, thread.session, thread.title);

// What the process wrote down, then what it sent before it died.
thread.job = { key, how: "run", goal, prompt: goal, fresh, since: {} };
await saveThread(thread);
const sent = await session.agent.run(goal, { idempotencyKey: key });
console.log("sent, then 'died': turn", sent.turnId);

// The next process has only the thread record.
const found = await readThread(thread.id);
assert.equal(found.job.turnId, undefined, "the turn was never recorded");
const outcome = await resume(found, { on: { step: () => {}, activity: (a) => a.state !== "running" && console.log("·", a.title), progress: () => {} } });

assert.equal(outcome.turnId, sent.turnId, "the same turn was found, not a second one started");
assert.equal(outcome.state, "completed");
assert.equal((await readThread(thread.id)).job, undefined, "the job is settled");
console.log("recovered the same turn:", outcome.text.replace(/\s+/g, " ").slice(0, 120));
process.exit(0);
