// A dry run of the whole claim without Tavus: calls the PAL's tools on the running app the way the page
// would, answers the Computer's questions as the customer would, and reports timings at the end. Use it to
// check the Computer side 10 times out of 10 before a rehearsal with the PAL.
//   npm run dev   (in another terminal)
//   npm run rehearse [-- --serial AP3-4471-9026] [-- --hangup 20]
//
// --hangup N waits N seconds after the first question before answering, as if the customer hung up to find
// the serial number and called back.

const app = process.env.DEMO_URL ?? "http://127.0.0.1:3100";
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const serial = arg("serial", "AP3-4471-9026");
const hangup = Number(arg("hangup", "0"));
const t0 = Date.now();
const at = () => `${((Date.now() - t0) / 1000).toFixed(0).padStart(4)}s`;
const log = (...a) => console.log(at(), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(path, body) {
  const r = await fetch(app + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${path}: ${data.error ?? r.status}`);
  return data;
}
const tool = (name, args) => post("/api/tool", { name, arguments: JSON.stringify(args), by: "operator" });
const state = async () => (await fetch(`${app}/api/state`)).json();

log("reset the case and the portal");
await post("/api/reset", { signOut: process.argv.includes("--signout") });
log("prepare the Computer");
await post("/api/computer", { action: "prepare" });
log("computer:", (await state()).computer.state);

log("PAL → start_warranty_claim");
log("  ←", (await tool("start_warranty_claim", { product: "AeroPure 300 air purifier", issue: "It won't power on", details: "Stopped turning on two days ago; the power light doesn't come on.", resolution: "Replacement" })).output);

const timings = {};
let asked = 0;
for (;;) {
  await sleep(2000);
  const { claim, steps } = await state();
  if (!claim) throw new Error("the claim disappeared");
  if (claim.state === "working") continue;
  if (claim.state === "needs_input") {
    asked++;
    log(`computer asks (${claim.questionKind}):`, claim.question);
    if (claim.questionKind === "approval") {
      timings.approval ??= at();
      log("customer → Yes, submit it.");
      log("  ←", (await tool("answer_claim_question", { answer: "Yes, please submit it." })).output);
    } else {
      timings.question ??= at();
      if (hangup && asked === 1) {
        log(`customer hangs up to find it; calling back in ${hangup}s`);
        await sleep(hangup * 1000);
      }
      const answer = /serial/i.test(claim.question) ? `The serial number is ${serial}.` : "I don't know. Please continue with what you have.";
      log("customer →", answer);
      log("  ←", (await tool("answer_claim_question", { answer })).output);
    }
    if (asked > 5) throw new Error("too many questions");
    continue;
  }
  timings.end = at();
  log(`ended: ${claim.state}`);
  log("summary:", claim.summary);
  log("claim number:", claim.claimNumber ?? "none", claim.verified ? "(confirmed in the portal)" : "(not confirmed)");
  log("files:", claim.files.map((f) => f.name).join(", ") || "none");
  log("steps:", steps.length, "· cost:", `$${claim.cost.toFixed(2)}`);
  log("first question at", timings.question ?? "-", "· approval at", timings.approval ?? "-", "· done at", timings.end);
  process.exit(claim.state === "done" && claim.verified ? 0 : 1);
}
