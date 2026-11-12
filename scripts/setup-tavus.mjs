// Creates (or updates) the PAL's three tools and the PAL itself on your Tavus account, and prints the
// TAVUS_PAL_ID to put in .env.local. Safe to run again: tools are matched by name, the PAL by TAVUS_PAL_ID.
//   npm run setup:tavus

const API = "https://tavusapi.com/v2";
const key = process.env.TAVUS_API_KEY;
if (!key) throw new Error("Set TAVUS_API_KEY in .env.local first.");

async function tavus(path, init = {}) {
  const r = await fetch(API + path, { ...init, headers: { "content-type": "application/json", "x-api-key": key, ...init.headers } });
  const text = await r.text();
  if (!r.ok) throw new Error(`${init.method ?? "GET"} ${path}: ${r.status} ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : {};
}

// Delivered to the page as app messages; the page answers with conversation.tool_result.
const TOOLS = [
  {
    name: "start_warranty_claim",
    description:
      "Start filing the customer's warranty claim in the Larkspur Care portal, on the support team's computer. Call it once you know which product and what's wrong. It returns right away while the computer works in the background; you'll get a claim task update when it needs something from the customer or when it's done. Never call it twice for the same claim.",
    parameters: {
      type: "object",
      properties: {
        product: { type: "string", description: "The product, in the customer's words, e.g. 'AeroPure 300 air purifier'." },
        issue: { type: "string", description: "What's wrong with it, in a few words, e.g. 'won't power on'." },
        details: { type: "string", description: "Anything else the customer said about the problem: when it started, what they tried." },
        resolution: { type: "string", enum: ["Replacement", "Repair"], description: "What the customer prefers. Replacement if they don't say." },
      },
      required: ["product", "issue"],
    },
    on_call: "generate_filler",
    on_resolve: "generate_response",
  },
  {
    name: "answer_claim_question",
    description:
      "Pass the customer's answer to the question the claim task asked: a fact such as the serial number, or their approval to submit. Use their exact words for facts. For approval, pass a clear yes or no.",
    parameters: { type: "object", properties: { answer: { type: "string", description: "The customer's answer, e.g. 'AP3-4471-9026' or 'Yes, submit it'." } }, required: ["answer"] },
    on_call: "generate_filler",
    on_resolve: "generate_response",
  },
  {
    name: "get_claim_status",
    description: "Check where the customer's warranty claim stands: working, waiting on the customer, or submitted.",
    parameters: { type: "object", properties: {} },
    on_call: "silent",
    on_resolve: "generate_response",
  },
];

const SYSTEM_PROMPT = `You are Riley, a customer support specialist at Larkspur Care, the support team for Larkspur Home Appliances. You're on a video call with a customer.

How you work: you handle the conversation; a computer on the support team does the work in Larkspur's systems. When the customer wants a warranty claim, call start_warranty_claim as soon as you know the product and the problem. The computer signs in to the portal, finds the order, checks the warranty and fills in the claim. It keeps working after the call ends.

Messages that start with "Claim task update, from the computer" come from that computer, not from the customer. Act on them right away:
- If it needs something from the customer (like the serial number), ask for it in your own words, briefly, and say where to find it if it told you. Then call answer_claim_question with exactly what the customer said.
- If it asks for approval to submit, read back the key details in one sentence and ask for a clear yes. Only a clear yes counts. Then call answer_claim_question.
- If it's done, give the claim number and the next steps.
- If it couldn't finish, say so plainly and offer a follow-up from a person.

Style: warm, calm, brief. One or two sentences at a time. Spell out claim numbers clearly. Don't read out long lists.

Guardrails: never invent order details, serial numbers, claim numbers or policy terms; only repeat what the customer or the claim task said. Never tell the customer a claim is submitted until a claim task update says so. If the customer has to go find something, tell them it's fine to hang up and call back: the claim waits for them.`;

const faceId = process.env.TAVUS_FACE_ID;

const ids = [];
for (const tool of TOOLS) {
  const found = (await tavus(`/tools?type=user&name_or_uuid=${encodeURIComponent(tool.name)}`)).data?.find((t) => t.name === tool.name);
  const body = { ...tool, origin: "llm", delivery: { app_message: true } };
  if (found) {
    await tavus(`/tools/${found.tool_id}`, { method: "PATCH", body: JSON.stringify(body) });
    ids.push(found.tool_id);
    console.log("updated tool", tool.name, found.tool_id);
  } else {
    const created = await tavus("/tools", { method: "POST", body: JSON.stringify(body) });
    ids.push(created.tool_id);
    console.log("created tool", tool.name, created.tool_id);
  }
}

let palId = process.env.TAVUS_PAL_ID;
if (palId) {
  await tavus(`/pals/${palId}`, { method: "PATCH", body: JSON.stringify([{ op: "replace", path: "/system_prompt", value: SYSTEM_PROMPT }]) });
  console.log("updated PAL", palId);
} else {
  if (!faceId) throw new Error("Set TAVUS_FACE_ID (a stock face) in .env.local, then run this again.");
  const created = await tavus("/pals", {
    method: "POST",
    body: JSON.stringify({ pal_name: "Riley · Larkspur Care (Pine Computer demo)", system_prompt: SYSTEM_PROMPT, pipeline_mode: "full", default_face_id: faceId }),
  });
  palId = created.pal_id;
  console.log("created PAL", palId);
}
await tavus(`/pals/${palId}/tools`, { method: "POST", body: JSON.stringify({ tool_ids: ids }) });
console.log("attached", ids.length, "tools");
console.log(`\nAdd to .env.local:\nTAVUS_PAL_ID=${palId}`);
