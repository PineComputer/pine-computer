// Your own agent at the controls: a model you call (Claude here) decides each step, and
// the session's drive API carries it out on the Computer. Pine's agent isn't involved;
// the Computer is the hands and eyes, your model is the brain.
//
// Claude's computer tool and Pine's drive actions share their names (left_click, type,
// scroll…) and most fields. toDriveAction translates the rest, says plainly what the
// Computer can't do, and a fresh screenshot goes back after anything that may change the
// screen.

import "server-only";
import type { Session } from "@pinesandbox/computer";
import { ApiError } from "@pinesandbox/computer";
import type { DriveStep } from "@/shared/api";

type Block = Record<string, unknown> & { type: string };
interface ModelReply {
  content: Block[];
  stop_reason: string;
}
/** One call to the model: the conversation so far in, its next reply out. */
export type Model = (messages: { role: string; content: unknown }[]) => Promise<ModelReply>;

/** The actions Pine's drive API carries out. hold_key, cursor_position and zoom aren't among them. */
const SUPPORTED = new Set([
  "screenshot",
  "left_click",
  "right_click",
  "middle_click",
  "double_click",
  "triple_click",
  "mouse_move",
  "left_mouse_down",
  "left_mouse_up",
  "left_click_drag",
  "scroll",
  "type",
  "key",
  "wait",
]);
const LOOKS = new Set(["screenshot", "wait"]);
const MAX_STEPS = 60;

// Claude names keys as xdotool does; the Computer takes the browser's names, and
// single characters, with alt, ctrl, cmd or shift.
const KEYS: Record<string, string> = {
  return: "Enter",
  enter: "Enter",
  kp_enter: "Enter",
  tab: "Tab",
  backspace: "Backspace",
  escape: "Escape",
  esc: "Escape",
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
  arrowup: "ArrowUp",
  arrowdown: "ArrowDown",
  arrowleft: "ArrowLeft",
  arrowright: "ArrowRight",
};
const MODIFIERS: Record<string, string> = { ctrl: "ctrl", control: "ctrl", alt: "alt", shift: "shift", cmd: "cmd", super: "cmd", meta: "cmd" };

/** An xdotool-style chord ("ctrl+Return") as the Computer names it ("ctrl+Enter"), or null. */
export function toKey(chord: string): string | null {
  const parts = chord.split("+").map((p) => p.trim()).filter(Boolean);
  const key = parts.pop();
  if (!key) return null;
  const mods = parts.map((m) => MODIFIERS[m.toLowerCase()]);
  if (mods.some((m) => !m)) return null;
  const name = key.length === 1 ? key : KEYS[key.toLowerCase()];
  return name ? [...mods, name].join("+") : null;
}

type Params = Record<string, unknown>;
const point = (value: unknown) => Array.isArray(value) && value.length === 2;

/** Claude's tool input as a Pine drive action, or why it can't be one. */
export function toDriveAction(input: Params): { action: string; params: Params } | { error: string } {
  const { action, ...params } = input;
  if (typeof action !== "string" || !SUPPORTED.has(action)) return { error: `The Computer can't do “${String(action)}”. Use another action.` };
  switch (action) {
    case "key": {
      const key = toKey(String(params.text ?? ""));
      if (!key) return { error: `The Computer can't press “${String(params.text)}”: it presses single characters, Enter, Tab, Backspace, Escape and the arrow keys. Scroll instead of paging.` };
      return { action, params: { text: key } };
    }
    case "wait":
      return { action, params: { duration_ms: Math.min(10_000, Math.round(Number(params.duration ?? 1) * 1000)) } };
    case "left_click_drag":
      if (!point(params.start_coordinate) || !point(params.coordinate)) return { error: "Give left_click_drag a start_coordinate and a coordinate." };
      return { action, params: { coordinate: params.start_coordinate, end_coordinate: params.coordinate } };
    case "scroll":
      if (!point(params.coordinate)) return { error: "Give scroll a coordinate: where on the last screenshot to scroll." };
      return { action, params: { coordinate: params.coordinate, scroll_direction: params.scroll_direction, scroll_amount: params.scroll_amount ?? 3 } };
    case "screenshot":
    case "type":
    case "left_mouse_up":
      return { action, params: action === "type" ? { text: params.text } : {} };
    default:
      // Clicks, moves and presses: a point, and no held keys.
      if (!point(params.coordinate)) return { error: `Give ${action} a coordinate: [x, y] on the last screenshot.` };
      if (params.text) return { error: "The Computer can't hold keys while clicking. Click, then press the keys." };
      return { action, params: { coordinate: params.coordinate } };
  }
}

/** Drives the session toward `goal` with `model`, reporting each step. */
export async function drive(session: Session, goal: string, model: Model, report: (step: DriveStep) => void, signal: AbortSignal): Promise<void> {
  const messages: { role: string; content: unknown }[] = [{ role: "user", content: goal }];
  for (let turn = 0; turn < MAX_STEPS && !signal.aborted; turn += 1) {
    const reply = await model(messages);
    messages.push({ role: "assistant", content: reply.content });
    for (const block of reply.content) if (block.type === "text" && typeof block.text === "string" && block.text.trim()) report({ type: "said", text: block.text });

    const uses = reply.content.filter((block) => block.type === "tool_use");
    if (reply.stop_reason !== "tool_use" || uses.length === 0) {
      report({ type: "done" });
      return;
    }
    const results: Block[] = [];
    let failed = false;
    for (const use of uses) {
      const result = (content: unknown[], isError = false): Block => ({
        type: "tool_result",
        tool_use_id: use.id,
        toolset_name: "computer",
        ...(isError ? { is_error: true } : {}),
        content,
      });
      // One failure stops the rest of the turn's actions: they assumed it worked.
      if (failed) {
        results.push(result([{ type: "text", text: "Not executed: an earlier computer action in this turn failed." }], true));
        continue;
      }
      const step = toDriveAction((use.input ?? {}) as Record<string, unknown>);
      if ("error" in step) {
        failed = true;
        results.push(result([{ type: "text", text: step.error }], true));
        continue;
      }
      report({ type: "action", action: step.action, text: describe(step.action, step.params) });
      try {
        const done = await session.drive.computerUse(step.action, step.params, { signal });
        // After anything that may change the screen, send the screen back with the result.
        const shot = step.action === "screenshot" ? done.screenshot : LOOKS.has(step.action) ? "" : (await session.drive.screenshot({ signal })).screenshot;
        if (shot) report({ type: "screen", src: `data:image/png;base64,${shot}` });
        results.push(result(shot ? [{ type: "image", source: { type: "base64", media_type: "image/png", data: shot } }] : [{ type: "text", text: "Done." }]));
      } catch (error) {
        failed = true;
        // 409: Pine's agent or a person holds the controls; say so and stop.
        if (error instanceof ApiError && error.status === 409) throw new Error("Someone else has the controls: wait for the agent to finish, or hand back.");
        results.push(result([{ type: "text", text: error instanceof Error ? error.message : "The action failed." }], true));
      }
    }
    messages.push({ role: "user", content: results });
  }
  report({ type: "done", text: signal.aborted ? "Stopped." : `Stopped after ${MAX_STEPS} steps.` });
}

function describe(action: string, params: Record<string, unknown>): string {
  const at = Array.isArray(params.coordinate) ? ` at ${params.coordinate.join(", ")}` : "";
  if (action === "type") return `Type “${String(params.text ?? "")}”`;
  if (action === "key") return `Press ${String(params.text ?? "")}`;
  if (action === "scroll") return `Scroll ${String(params.scroll_direction ?? "")}${at}`;
  return `${action.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())}${at}`;
}

const SYSTEM =
  "You operate a web browser on a remote computer through the computer tool. Start with a screenshot. " +
  "Work step by step, check the screen after each action, and finish with a short plain answer.";

/** Claude through the Messages API, with the computer tool. Reads ANTHROPIC_API_KEY and ANTHROPIC_MODEL. */
export function claude(signal: AbortSignal): Model | null {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  return async (messages) => {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal,
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-opus-5-5",
        max_tokens: 2048,
        system: SYSTEM,
        // Pine's drive API has no zoom: the model works from whole screenshots.
        tools: [{ type: "computer_toolset_20260801", configs: { zoom: { enabled: false } } }],
        messages,
      }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(`The model refused the call: ${body?.error?.message ?? response.status}`);
    return body as ModelReply;
  };
}
