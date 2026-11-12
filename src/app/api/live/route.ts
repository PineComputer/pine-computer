// The demo as it happens, as server-sent events: the snapshot first, then every change, step and nudge.

import { follow } from "@/server/claim";
import { subscribe } from "@/server/live";
import { snapshot } from "@/server/snapshot";
import { watch } from "@/server/watch";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  follow();
  watch();
  const encoder = new TextEncoder();
  let stop = () => {};
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          stop();
        }
      };
      const unsubscribe = subscribe((e) => send(e.type, e));
      const beat = setInterval(() => send("ping", {}), 15_000);
      stop = () => {
        clearInterval(beat);
        unsubscribe();
      };
      request.signal.addEventListener("abort", () => {
        stop();
        try {
          controller.close();
        } catch {}
      });
      send("snapshot", await snapshot());
    },
    cancel() {
      stop();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" } });
}
