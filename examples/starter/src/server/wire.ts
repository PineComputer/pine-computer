import "server-only";
import type { AgentActivity, AgentEvent, ControlEvent } from "@pinesandbox/computer";
import type { Step, WireControl, WireEvent } from "@/shared/events";
import { words } from "./http";

const step = (activity: AgentActivity): Step => ({
  id: activity.id,
  state: activity.state,
  kind: activity.kind,
  title: activity.title,
  ...(activity.facts
    ? { facts: { page: activity.facts.page, steps: activity.facts.steps, files: activity.facts.files, skill: activity.facts.skill } }
    : {}),
});

/** The SDK's event, as the page needs it; null for types the page doesn't draw. */
export function toWire(event: AgentEvent): WireEvent | null {
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
      return activity ? { ...base, step: step(activity) } : null;
    }
    case "frame": {
      const frame = event.frame();
      if (!frame) return null;
      const src = `data:${frame.mediaType};base64,${Buffer.from(frame.data).toString("base64")}`;
      return { ...base, frame: { src, stepId: frame.activity?.id } };
    }
    case "controller_changed":
      return { ...base, controller: event.controller };
    case "result": {
      const result = event.result();
      if (!result) return null;
      const draft = result.author?.draft as { name?: string; version?: number } | undefined;
      return {
        ...base,
        outcome: {
          reason: result.terminalReason,
          summary: result.summary,
          files: result.artifacts.map((file) => ({ path: file.relativePath, size: file.size })),
          durationMs: result.usage.duration.totalMs,
          cost: result.usage.cost.total,
          ...(result.author
            ? {
                author: {
                  draft: draft?.name ? { name: draft.name, version: Number(draft.version) } : undefined,
                  questions: result.author.questions,
                  handoffId: result.author.handoffId,
                },
              }
            : {}),
        },
      };
    }
    default:
      return null;
  }
}

const text = (value: unknown) => (typeof value === "string" && value ? value : undefined);

export function toWireControl(event: ControlEvent): WireControl {
  const data = event.data;
  return {
    id: event.id,
    type: event.type,
    controller: text(data.controller),
    humanSession: text(data.current_human_session),
    handoffId: text(data.handoff_id),
    idleDeadline: text(data.idle_deadline),
    idlePaused: typeof data.idle_paused === "boolean" ? data.idle_paused : undefined,
  };
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
