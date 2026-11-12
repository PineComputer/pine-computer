// The PAL's tool calls, relayed by the page from Tavus's conversation.tool_call events (and the operator's
// fallback buttons). Each answers at once with the output the page returns as conversation.tool_result.

import { answerClaim, claimStatus, startClaim } from "@/server/claim";
import { body, HttpError, route } from "@/server/http";
import { TOOLS } from "@/shared/api";

export const dynamic = "force-dynamic";

interface Call {
  name: string;
  /** The tool's arguments: Tavus sends a JSON string. */
  arguments?: string | Record<string, unknown>;
  toolCallId?: string;
  by?: "pal" | "operator";
}

export const POST = route(async (request) => {
  const call = await body<Call>(request);
  let args: Record<string, unknown> = {};
  try {
    args = typeof call.arguments === "string" ? (call.arguments ? JSON.parse(call.arguments) : {}) : (call.arguments ?? {});
  } catch {
    throw new HttpError(400, "The tool's arguments aren't JSON.");
  }
  const text = (k: string) => (typeof args[k] === "string" ? (args[k] as string) : "");
  const by = call.by === "operator" ? "operator" : "pal";
  switch (call.name) {
    case TOOLS.start:
      if (!text("product") || !text("issue")) return { output: "I need the product and what's wrong with it before I can start the claim.", status: "error" };
      return { output: await startClaim({ product: text("product"), issue: text("issue"), details: text("details"), resolution: text("resolution") }, by, call.toolCallId) };
    case TOOLS.answer:
      if (!text("answer")) return { output: "I didn't get the customer's answer.", status: "error" };
      return { output: await answerClaim(text("answer"), by === "operator" ? "operator" : "customer") };
    case TOOLS.status:
      return { output: await claimStatus() };
    default:
      throw new HttpError(404, `No tool called ${call.name}.`);
  }
});
