// The Tavus side: start a conversation with the PAL, carrying what the claim needs the PAL to know. A
// call-back starts a new conversation whose context and greeting pick up the claim where it stands.
//
// Two ways to drive the work. Our own PAL (npm run setup:tavus) calls the three tools itself ("pal" mode). A
// built-in PAL such as Charlie has no tools, so the page listens to what the customer says and calls them
// ("page" mode); the PAL gets the support role and the updates through its context either way.

import "server-only";
import type { ClaimCase } from "./store";
import { read, update } from "./store";
import { TOOLS } from "@/shared/api";

const API = "https://tavusapi.com/v2";

export const tavusConfigured = () => !!(process.env.TAVUS_API_KEY && process.env.TAVUS_PAL_ID);

async function tavus<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: { "content-type": "application/json", "x-api-key": process.env.TAVUS_API_KEY ?? "", ...init.headers },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Tavus ${init.method ?? "GET"} ${path}: ${response.status} ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

export type Mode = "pal" | "page";
export interface PalInfo {
  /** The PAL's first name, as the screen shows it. */
  name: string;
  mode: Mode;
}

const shared = globalThis as typeof globalThis & { __demoPal?: Map<string, Promise<PalInfo>> };

/** Who the PAL is, and whether it has our tools. Asked once per PAL. */
export function palInfo(): Promise<PalInfo> {
  const id = process.env.TAVUS_PAL_ID ?? "";
  const cache = (shared.__demoPal ??= new Map());
  let found = cache.get(id);
  if (!found) {
    found = (async () => {
      const [pal, tools] = await Promise.all([
        tavus<{ pal_name?: string }>(`/pals/${encodeURIComponent(id)}`),
        tavus<{ data?: { name: string }[] }>(`/pals/${encodeURIComponent(id)}/tools`).catch(() => ({ data: [] })),
      ]);
      const name = (pal.pal_name ?? "Riley").trim().split(/[\s·—-]+/)[0] || "Riley";
      return { name, mode: tools.data?.some((t) => t.name === TOOLS.start) ? "pal" : "page" } satisfies PalInfo;
    })();
    found.catch(() => cache.delete(id));
    cache.set(id, found);
  }
  return found;
}

/** For a PAL without our tools: who it is on this call, and how the work reaches it. */
function role(name: string): string {
  return `For this call you are ${name}, a customer support specialist at Larkspur Care, the support team for Larkspur Home Appliances, on a video call with a customer. You handle the conversation; a support computer does the work in Larkspur's systems. When the customer asks for a warranty claim, the computer starts it automatically as soon as they ask: tell them you've started it and it's looking up their order. Messages that start with "Claim task update, from the computer" come from that computer, not from the customer. If it needs something, such as the serial number, ask the customer for it in your own words and say where to find it. If it asks for approval, read the key details back in one sentence and ask for a clear yes. If it's done, give the claim number and the next steps. Never invent order details, serial numbers or claim numbers. Keep replies to one or two sentences. If the customer has to go and find something, tell them it's fine to hang up and call back: the claim waits for them.`;
}

/** What the PAL knows about the claim at the start of a call. */
export function contextFor(c: ClaimCase | undefined, mode: Mode = "pal", name = "Riley"): string {
  const lead = mode === "page" ? `${role(name)} ` : "";
  const who = `${lead}The customer on this call is Jordan Lee (jordan.lee@example.com), signed in to Larkspur Care.`;
  const answer = mode === "pal" ? `then call ${TOOLS.answer} with what the customer said` : "and the computer hears the answer";
  if (!c) return `${who} No warranty claim has been started yet.`;
  const asked = `The customer asked for a warranty claim: ${c.request.product}; problem: ${c.request.issue}; preferred resolution: ${c.request.resolution}.`;
  switch (c.state) {
    case "working":
      return `${who} ${asked} The computer is working on it in the portal right now.${mode === "pal" ? ` Use ${TOOLS.status} if the customer asks how it's going.` : ""}`;
    case "needs_input":
      return c.questionKind === "approval"
        ? `${who} ${asked} The claim is filled in on the portal's review page but NOT submitted. The computer is waiting for the customer's approval: "${c.question}" Read the key details back briefly, get a clear yes or no, ${answer}.`
        : `${who} ${asked} The computer is waiting for the customer: "${c.question}" Ask for it, ${answer}. Never make one up.`;
    case "done":
      return `${who} ${asked} The claim is submitted. ${c.summary ?? ""} Claim number: ${c.claimNumber ?? "in the summary"}.`;
    default:
      return `${who} ${asked} The claim task stopped before it finished${c.summary ? `: ${c.summary}` : ""}. Offer to start it again.`;
  }
}

/** The PAL's first line: a welcome, or the thread of an open claim picked up. */
export function greetingFor(c: ClaimCase | undefined, name = "Riley"): string {
  if (!c) return `Hi Jordan, this is ${name} from Larkspur Care. What can I help you with today?`;
  if (c.state === "needs_input" && c.questionKind === "approval") return "Welcome back, Jordan. Your claim is filled in and ready to go. I just need your OK before I submit it.";
  if (c.state === "needs_input" && /serial/i.test(c.question ?? "")) return "Welcome back, Jordan. Your claim is all set except for one thing. Did you find the serial number?";
  if (c.state === "needs_input") return "Welcome back, Jordan. Your claim is almost done. I just need one more detail from you.";
  if (c.state === "working") return "Welcome back, Jordan. I'm still working on your claim. It's moving along.";
  if (c.state === "done") return `Welcome back, Jordan. Your claim ${c.claimNumber ?? ""} is submitted. Anything else I can help with?`;
  return "Hi Jordan, welcome back. Let's pick your claim back up.";
}

export async function startConversation(): Promise<{ id: string; url: string } & PalInfo> {
  if (!tavusConfigured()) throw new Error("Add TAVUS_API_KEY and TAVUS_PAL_ID to .env.local (npm run setup:tavus creates the PAL).");
  const [claim, pal] = await Promise.all([read().then((d) => d.claim), palInfo()]);
  const body: Record<string, unknown> = {
    pal_id: process.env.TAVUS_PAL_ID,
    conversation_name: `Larkspur Care · ${claim ? `claim ${claim.id}` : "new"} · ${new Date().toISOString().slice(0, 16)}`,
    conversational_context: contextFor(claim, pal.mode, pal.name),
    custom_greeting: greetingFor(claim, pal.name),
    properties: { max_call_duration: 1200, participant_left_timeout: 10 },
  };
  // Our own PAL takes the face chosen for it; a built-in PAL keeps its own.
  if (process.env.TAVUS_FACE_ID && pal.mode === "pal") body.face_id = process.env.TAVUS_FACE_ID;
  const created = await tavus<{ conversation_id: string; conversation_url: string }>("/conversations", { method: "POST", body: JSON.stringify(body) });
  await update((d) => {
    d.conversations.push({ id: created.conversation_id, url: created.conversation_url, startedAt: new Date().toISOString() });
  });
  return { id: created.conversation_id, url: created.conversation_url, ...pal };
}

export async function endConversation(id: string): Promise<void> {
  await tavus(`/conversations/${encodeURIComponent(id)}/end`, { method: "POST" }).catch((error) => console.error("[tavus] end:", error));
}
