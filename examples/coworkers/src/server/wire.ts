import "server-only";
import type { AgentEvent, ControlEvent } from "@pinesandbox/computer";
import type { WireControl, WireEvent } from "@/shared/events";
import { words } from "./http";

const BLANK_BYTES = 8_000;

/**
 * The SDK's event, as the page needs it; null for types the page doesn't draw. A picture
 * of the screen goes to the page as a data URL, unless `picture` says where it is kept.
 */
export function toWire(event: AgentEvent, picture?: (data: Uint8Array, mediaType: string) => string): WireEvent | null {
  const base = { id: event.eventId, turnId: event.turnId, at: event.ts?.getTime() ?? Date.now(), type: event.type };
  switch (event.type) {
    case "input": {
      const input = event.input();
      return input ? { ...base, input: { kind: input.kind, text: input.text } } : null;
    }
    case "progress": {
      const progress = event.progress();
      return progress ? { ...base, progress } : null;
    }
    case "activity": {
      const activity = event.activity();
      if (!activity) return null;
      const { id, state, kind, title, facts } = activity;
      return { ...base, step: { id, state, kind, title, url: facts?.page?.url, page: facts?.page?.title } };
    }
    case "frame": {
      const frame = event.frame();
      // A picture this small is a blank screen (a page that hasn't painted yet): it says nothing.
      if (!frame || frame.data.byteLength < BLANK_BYTES) return null;
      const src = picture ? picture(frame.data, frame.mediaType) : `data:${frame.mediaType};base64,${Buffer.from(frame.data).toString("base64")}`;
      return { ...base, frame: { src, stepId: frame.activity?.id } };
    }
    case "controller_changed":
      return { ...base, controller: event.controller };
    case "result": {
      const result = event.result();
      if (!result) return null;
      return {
        ...base,
        outcome: {
          reason: result.terminalReason,
          summary: result.summary,
          files: result.artifacts.map((file) => ({ path: file.relativePath, size: file.size })),
          durationMs: result.usage.duration.totalMs,
          cost: result.usage.cost.total,
        },
      };
    }
    default:
      return null;
  }
}

const text = (value: unknown) => (typeof value === "string" && value ? value : undefined);

export function toWireControl(event: ControlEvent): WireControl {
  return { id: event.id, type: event.type, controller: text(event.data.controller), idleDeadline: text(event.data.idle_deadline) };
}

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

export const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
  });
