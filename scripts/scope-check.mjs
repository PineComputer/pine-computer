// Two projects against one store: what one saves, the other must not find. Runs on the files in
// PINE_COMPUTER_HOME, or on Postgres with PINE_DATABASE_URL and PINE_STORE_KEY set.
//
//   PINE_COMPUTER_HOME=$(mktemp -d) node scripts/scope-check.mjs

import assert from "node:assert/strict";
import { inScope, own, projectOf, scoped, store } from "../dist/core/store.js";
import { readThread, saveThread, titlesOf } from "../dist/core/thread.js";
import { jobOf } from "../dist/jobs.js";

const a = { project: projectOf("key-of-project-a"), client: null };
const b = { project: projectOf("key-of-project-b"), client: null };
const thread = { id: "same-thread-id", computer: "default", session: "chat-1", title: "A's job", createdAt: new Date().toISOString(), history: [] };

await inScope(a, () => saveThread(thread));
assert.equal((await inScope(a, () => readThread(thread.id)))?.title, "A's job", "a project reads its own thread");
assert.equal(await inScope(b, () => readThread(thread.id)), undefined, "another project doesn't find it");
assert.equal(await readThread(thread.id), undefined, "nor does a caller with no project");
assert.equal((await inScope(b, () => titlesOf("default"))).size, 0, "nor by listing");
assert.equal((await inScope(a, () => titlesOf("default"))).get("chat-1"), "A's job", "its owner lists it");

assert.notEqual(inScope(a, () => scoped("t")), inScope(b, () => scoped("t")), "jobs in memory are kept apart");
assert.notEqual(inScope(a, () => own("files", "t")), inScope(b, () => own("files", "t")), "so are files on disk");
assert.equal(inScope(b, () => jobOf(thread.id)), undefined);

// A lock in one project doesn't hold up the same name in another.
await inScope(a, () => store().lock("computer-default", () => inScope(b, () => store().lock("computer-default", async () => {}))));

await inScope(a, () => store().delete(["threads", thread.id]));
assert.equal(await inScope(a, () => readThread(thread.id)), undefined, "and it can be deleted");
console.log("scope check passed on", process.env.PINE_DATABASE_URL ? "Postgres" : "files");
process.exit(0);
