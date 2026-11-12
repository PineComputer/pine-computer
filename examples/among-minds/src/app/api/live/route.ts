// Tells open pages when anything happened, so they read again. One line per change.

import { onEvent } from "@/engine/record";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const encoder = new TextEncoder();
  let stop = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (text: string) => {
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          stop();
        }
      };
      send("retry: 3000\n\n");
      const off = onEvent((kind) => send(`data: ${JSON.stringify({ kind })}\n\n`));
      const keepalive = setInterval(() => send(": keepalive\n\n"), 15_000);
      stop = () => {
        off();
        clearInterval(keepalive);
      };
      request.signal.addEventListener("abort", () => {
        stop();
        try {
          controller.close();
        } catch {}
      });
    },
    cancel() {
      stop();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store" } });
}
