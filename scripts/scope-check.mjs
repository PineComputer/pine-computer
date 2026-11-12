// Two projects against one store: what one saves, the other must not find. Runs on the files in
// PINE_COMPUTER_HOME, or on Postgres with PINE_DATABASE_URL and PINE_STORE_KEY set.
//
//   npm run build && PINE_COMPUTER_HOME=$(mktemp -d) node scripts/scope-check.mjs

import assert from "node:assert/strict";
import { exact } from "../dist/core/home.js";
import { inScope, own, scoped, store, useStore } from "../dist/core/store.js";
import { postgres } from "../dist/hosted/postgres.js";
import { readThread, saveThread, titlesOf } from "../dist/core/thread.js";
import { jobOf } from "../dist/jobs.js";

if (process.env.PINE_DATABASE_URL) useStore(await postgres(process.env.PINE_DATABASE_URL, Buffer.from(process.env.PINE_STORE_KEY ?? "", "base64")));

const a = { project: "project-a", client: null };
const b = { project: "project-b", client: null };
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

// Many holders waiting on one lock, each reading and writing while it holds it, all finish in turn.
let held = 0;
await Promise.all(
  Array.from({ length: 30 }, (_, i) =>
    inScope(a, () =>
      store().lock("busy", async () => {
        assert.equal(++held, 1, "one holder at a time");
        await store().set(["scratch", "n"], { i });
        await store().get(["scratch", "n"]);
        held--;
      }),
    ),
  ),
);
await inScope(a, () => store().delete(["scratch", "n"]));

// Ids a client chooses stay apart even where a file name would fold them together.
assert.notEqual(exact("a/b"), exact("a-b"));
assert.notEqual(exact(`${"x".repeat(80)}1`), exact(`${"x".repeat(80)}2`));
assert.equal(exact("5f2f9cfe-bd34-4cd2-84cc-cf69c6c1a7a0"), "5f2f9cfe-bd34-4cd2-84cc-cf69c6c1a7a0");

await inScope(a, () => store().delete(["threads", thread.id]));
assert.equal(await inScope(a, () => readThread(thread.id)), undefined, "and it can be deleted");
console.log("scope check passed on", process.env.PINE_DATABASE_URL ? "Postgres" : "files");
process.exit(0);
