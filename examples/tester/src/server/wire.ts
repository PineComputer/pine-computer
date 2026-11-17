import "server-only";
import { words } from "./http";

/** A server-sent event, written out. */
export function sse(data: unknown, options: { id?: string; event?: string } = {}): string {
  return `${options.id ? `id: ${options.id}\n` : ""}${options.event ? `event: ${options.event}\n` : ""}data: ${JSON.stringify(data)}\n\n`;
}

/** A response that streams server-sent events from `run` until the page goes away. */
export function eventStream(request: Request, run: (send: (text: string) => void, signal: AbortSignal) => Promise<void>): Response {
  const encoder = new TextEncoder();
  const done = new AbortController();
  request.signal.addEventListener("abort", () => done.abort(), { once: true });
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (text: string) => {
        if (!done.signal.aborted) controller.enqueue(encoder.encode(text));
      };
      // A comment now and then keeps proxies from closing a quiet stream.
      const keepalive = setInterval(() => send(": keepalive\n\n"), 15_000);
      try {
        send("retry: 2000\n\n");
        await run(send, done.signal);
      } catch (error) {
        if (!done.signal.aborted) {
          console.error("stream:", error);
          send(sse({ error: error instanceof Error ? words(error.message) : "The stream stopped." }, { event: "problem" }));
        }
      } finally {
        clearInterval(keepalive);
        done.abort();
        try {
          controller.close();
        } catch {
          // the page already went away
        }
      }
    },
    cancel() {
      done.abort();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" } });
}
