// What the server tells the open page as it happens: the case changed, the agent took a step, and
// nudges the page relays into the live Tavus call. /api/live streams it.

import "server-only";
import { EventEmitter } from "node:events";
import type { LiveEvent, Step } from "@/shared/api";

const shared = globalThis as typeof globalThis & { __demoLive?: EventEmitter; __demoSteps?: Step[] };
shared.__demoLive ??= new EventEmitter().setMaxListeners(0);
shared.__demoSteps ??= [];
const live = shared.__demoLive;

export function publish(event: LiveEvent): void {
  if (event.type === "step") {
    const steps = shared.__demoSteps!;
    const i = steps.findIndex((s) => s.id === event.step.id);
    if (i >= 0) steps[i] = event.step;
    else steps.push(event.step);
    if (steps.length > 60) steps.splice(0, steps.length - 60);
  }
  live.emit("event", event);
}

export function subscribe(listener: (event: LiveEvent) => void): () => void {
  live.on("event", listener);
  return () => live.off("event", listener);
}

/** The latest steps, for a page that opens mid-task. */
export const recentSteps = (): Step[] => [...shared.__demoSteps!];
export const clearSteps = (): void => void shared.__demoSteps!.splice(0);
