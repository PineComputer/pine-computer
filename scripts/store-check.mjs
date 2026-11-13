// What several processes and several clients rely on in the records under PINE_COMPUTER_HOME: a thread is
// saved and found again, one holder of a lock at a time, and ids a client chooses never fold together.
// Needs no key and starts no Computer.
//
//   npm run build && PINE_COMPUTER_HOME=$(mktemp -d) node scripts/store-check.mjs

import assert from "node:assert/strict";
import { exact } from "../dist/core/home.js";
import { store } from "../dist/core/store.js";
import { readThread, saveThread, titlesOf } from "../dist/core/thread.js";

const thread = { id: "check-thread", computer: "default", session: "chat-1", title: "A job", createdAt: new Date().toISOString(), history: [] };
await saveThread(thread);
assert.equal((await readThread(thread.id))?.title, "A job", "a saved thread is read back");
assert.equal((await titlesOf("default")).get("chat-1"), "A job", "and found by its Computer");

// Many holders waiting on one lock, each reading and writing while it holds it, all finish in turn.
let held = 0;
await Promise.all(
  Array.from({ length: 30 }, (_, i) =>
    store().lock("busy", async () => {
      assert.equal(++held, 1, "one holder at a time");
      await store().set(["scratch", "n"], { i });
      await store().get(["scratch", "n"]);
      held--;
    }),
  ),
);
await store().delete(["scratch", "n"]);

// Ids a client chooses stay apart even where a file name would fold them together.
assert.notEqual(exact("a/b"), exact("a-b"));
assert.notEqual(exact(`${"x".repeat(80)}1`), exact(`${"x".repeat(80)}2`));
assert.equal(exact("5f2f9cfe-bd34-4cd2-84cc-cf69c6c1a7a0"), "5f2f9cfe-bd34-4cd2-84cc-cf69c6c1a7a0");

await store().delete(["threads", thread.id]);
assert.equal(await readThread(thread.id), undefined, "and it can be deleted");
console.log("store check passed");
process.exit(0);
