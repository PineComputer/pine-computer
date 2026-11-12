// Drives the session with your own model (src/server/drive.ts) and streams each step to
// the page, one JSON object per line, until the model is done or the page goes away.

import { HttpError, body, required, route, words } from "@/server/http";
import { claude, drive } from "@/server/drive";
import { requireSession } from "@/server/pine";
import { currentUser } from "@/server/user";

export const dynamic = "force-dynamic";

export const POST = route<{ session: string }>(async (request, { session }) => {
  const goal = required((await body<{ goal?: string }>(request)).goal, "Say what it should do.");
  const model = claude(request.signal);
  if (!model) throw new HttpError(409, "Set ANTHROPIC_API_KEY on the server to drive with your own model.");
  const target = await requireSession(await currentUser(), session);
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (line: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
      try {
        await drive(target, goal, model, write, request.signal);
      } catch (error) {
        if (!request.signal.aborted) write({ type: "error", text: error instanceof Error ? words(error.message) : "It stopped." });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
});
