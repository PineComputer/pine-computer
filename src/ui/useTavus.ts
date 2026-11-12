"use client";

// The page's half of the integration. Tavus delivers the PAL's tool calls to this page as app messages
// (conversation.tool_call); the page runs them on this app's server and returns conversation.tool_result.
// When the Computer asks or finishes, the server sends a nudge: the page appends it to the PAL's context
// (conversation.append_llm_context) and prompts a reply (conversation.respond), once per conversation,
// when nobody is mid-sentence.

import { useCallback, useRef, useState } from "react";
import type { DailyCall } from "@daily-co/daily-js";
import { TOOLS, type Nudge, type Snapshot } from "@/shared/api";
import { post } from "./useLive";

export interface Line {
  role: "user" | "pal" | "tool" | "relay";
  text: string;
}

type TavusEvent = { event_type?: string; conversation_id?: string; properties?: Record<string, unknown> };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const KNOWN = new Set<string>(Object.values(TOOLS));

/** A tool call's arguments as people read them: no filler line, no JSON. */
function readable(args: unknown): string {
  let a: Record<string, unknown> = {};
  try {
    a = typeof args === "string" ? JSON.parse(args || "{}") : ((args ?? {}) as Record<string, unknown>);
  } catch {
    return String(args);
  }
  return Object.entries(a)
    .filter(([k]) => k !== "response_to_user")
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join(", ");
}

export function useTavus() {
  const frame = useRef<DailyCall | null>(null);
  /** ?film: the PAL's picture and voice, drawn by this page instead of Daily's own call window. */
  const picture = useRef<HTMLDivElement | null>(null);
  const container = useRef<HTMLDivElement | null>(null);
  const conversation = useRef<string>("");
  const delivered = useRef(new Set<string>());
  const speaking = useRef({ pal: false, user: false, quietSince: Date.now() });
  const typed = useRef("");
  const relayed = useRef<string[]>([]);
  const [state, setState] = useState<"idle" | "starting" | "live" | "ending">("idle");
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** Calls joined since the page opened: the second one is the call-back. */
  const [calls, setCalls] = useState(0);
  /** "pal": the PAL calls the tools. "page": a PAL without them, so the page acts on what the customer says. */
  const mode = useRef<"pal" | "page">("pal");
  /** What the page does with each thing the customer says, in "page" mode. Set by the screen. */
  const onCustomer = useRef<(text: string) => void>(() => {});
  const say = useCallback((line: Line) => setLines((l) => [...l, line].slice(-40)), []);

  const send = useCallback((event_type: string, properties: Record<string, unknown>) => {
    frame.current?.sendAppMessage({ message_type: "conversation", event_type, conversation_id: conversation.current, properties }, "*");
  }, []);

  const onMessage = useCallback(
    async (data: TavusEvent) => {
      const p = data.properties ?? {};
      switch (data.event_type) {
        case "conversation.tool_call": {
          const name = String(p.name ?? "");
          if (!KNOWN.has(name)) return;
          const id = p.tool_call_id as string | undefined;
          say({ role: "tool", text: `${name}(${readable(p.arguments)})` });
          let output: string;
          let status: "success" | "error" = "success";
          try {
            const r = await post<{ output: string; status?: "success" | "error" }>("/api/tool", { name, arguments: p.arguments, toolCallId: id });
            output = r.output;
            status = r.status ?? "success";
          } catch (e) {
            output = `The tool failed: ${(e as Error).message}`;
            status = "error";
          }
          if (id) send("conversation.tool_result", { tool_call_id: id, output, status });
          say({ role: "tool", text: `→ ${output}` });
          return;
        }
        case "conversation.utterance": {
          const role = p.role === "user" ? "user" : p.role === "pal" ? "pal" : null; // PAL turns also arrive as "replica"
          const text = String(p.speech ?? "").trim();
          // The page's own nudges and typed lines arrive back as user turns: they're shown already, or not speech.
          if (role === "user" && (/^\[?Claim task update/.test(text) || text === typed.current || relayed.current.some((r) => r.includes(text.slice(0, 60))))) return;
          if (role && text) say({ role, text });
          if (role === "user" && text && mode.current === "page") onCustomer.current(text);
          return;
        }
        case "conversation.started_speaking":
        case "conversation.stopped_speaking": {
          const who = p.role === "user" ? "user" : "pal";
          speaking.current[who] = data.event_type === "conversation.started_speaking";
          if (!speaking.current.pal && !speaking.current.user) speaking.current.quietSince = Date.now();
          return;
        }
      }
    },
    [say, send],
  );

  const start = useCallback(async () => {
    setError(null);
    setState("starting");
    try {
      // What the call already knows from its context and greeting needs no nudge.
      const [{ id, url, mode: how }, snap] = await Promise.all([
        post<{ id: string; url: string; mode: "pal" | "page" }>("/api/conversation"),
        fetch("/api/state").then((r) => r.json() as Promise<Snapshot>),
      ]);
      conversation.current = id;
      mode.current = how;
      delivered.current = new Set(snap.nudge ? [snap.nudge.id] : []);
      setLines([]);
      const Daily = (await import("@daily-co/daily-js")).default;
      const query = new URLSearchParams(location.search);
      const film = query.has("film");
      // ?film is for recording: the call has no window of its own, only the PAL's picture filling the panel, and
      // the customer is heard but not seen.
      const call = film
        ? Daily.createCallObject({ videoSource: false, startVideoOff: true, startAudioOff: false })
        : Daily.createFrame(container.current!, {
            iframeStyle: { position: "absolute", inset: "0", width: "100%", height: "100%", border: "0" },
            showLeaveButton: false,
            showFullscreenButton: false,
            // Camera and microphone on: the PAL sees and hears the customer. ?muted joins without them, for a
            // scripted run where the customer's lines are typed.
            ...(query.has("muted") ? { startVideoOff: true, startAudioOff: true } : { startVideoOff: false, startAudioOff: false }),
          });
      frame.current = call;
      if (film) {
        const stage = document.createElement("div");
        stage.className = "film-call";
        const video = Object.assign(document.createElement("video"), { autoplay: true, muted: true, playsInline: true });
        const audio = Object.assign(document.createElement("audio"), { autoplay: true });
        stage.append(video, audio);
        container.current!.append(stage);
        picture.current = stage;
        call.on("track-started", (e) => {
          if (!e || e.participant?.local) return;
          const el = e.track.kind === "video" ? video : audio;
          el.srcObject = new MediaStream([e.track]);
          void el.play().catch(() => undefined);
          if (e.track.kind === "video") stage.classList.add("on");
        });
      }
      call.on("app-message", (e) => e && void onMessage(e.data as TavusEvent));
      call.on("left-meeting", () => {
        frame.current?.destroy();
        frame.current = null;
        picture.current?.remove();
        setState("idle");
      });
      await call.join({ url, userName: "Jordan Lee" }); // a name skips Daily's name prompt
      if (!film) call.setActiveSpeakerMode(true); // whoever talks, mostly Riley, fills the panel
      setCalls((n) => n + 1);
      setState("live");
    } catch (e) {
      setError((e as Error).message);
      frame.current?.destroy();
      frame.current = null;
      picture.current?.remove();
      setState("idle");
    }
  }, [onMessage]);

  const end = useCallback(async () => {
    setState("ending");
    const id = conversation.current;
    await frame.current?.leave().catch(() => undefined);
    frame.current?.destroy();
    frame.current = null;
    picture.current?.remove();
    if (id) await post(`/api/conversation/${encodeURIComponent(id)}`, undefined, "DELETE").catch(() => undefined);
    setState("idle");
  }, []);

  /** Tells the live call what the Computer needs or did. Without a call, the next call's context carries it. */
  const relay = useCallback(
    async (nudge: Nudge) => {
      if (!frame.current || delivered.current.has(nudge.id)) return;
      delivered.current.add(nudge.id);
      const started = Date.now();
      while (Date.now() - started < 10_000) {
        const s = speaking.current;
        if (!s.pal && !s.user && Date.now() - s.quietSince > 700) break;
        await sleep(200);
      }
      send("conversation.append_llm_context", { context: nudge.context });
      relayed.current.push(nudge.prompt);
      send("conversation.respond", { text: nudge.prompt });
      say({ role: "relay", text: nudge.kind === "question" ? "Computer → PAL: needs the customer" : nudge.kind === "done" ? "Computer → PAL: claim submitted" : "Computer → PAL: couldn't finish" });
    },
    [say, send],
  );

  /** A line from the customer, typed instead of spoken: the PAL answers it as if it had heard it. */
  const type = useCallback(
    (text: string) => {
      if (!frame.current || !text.trim()) return;
      typed.current = text.trim();
      send("conversation.respond", { text: text.trim() });
      say({ role: "user", text: text.trim() });
      if (mode.current === "page") onCustomer.current(text.trim());
    },
    [say, send],
  );

  /** Adds to the PAL's context without prompting a reply: the PAL uses it in its next turn. */
  const context = useCallback((text: string) => send("conversation.append_llm_context", { context: text }), [send]);

  return { container, state, lines, error, calls, start, end, relay, type, context, onCustomer, mode, say };
}
