"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TOOLS, type CaseView, type Step } from "@/shared/api";
import { Desktop } from "./Desktop";
import { post, useLive, type Live } from "./useLive";
import { useTavus, type Line } from "./useTavus";

type Tavus = ReturnType<typeof useTavus>;

const Mark = () => (
  <svg className="mark" viewBox="0 0 26 26" aria-label="Pine Computer">
    <path d="M1 7V1h6M19 1h6v6M1 19v6h6M25 19v6h-6" fill="none" stroke="#eef0e8" strokeWidth="2" strokeLinecap="square" />
    <circle cx="13" cy="13" r="5.2" fill="#2fd892" />
  </svg>
);

const SERIAL = "AP3-4471-9026";
/** The PAL on this call, by its first name: set from the server each render (Riley, or a built-in PAL like Charlie). */
const PAL = { name: "Riley" };
const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/**
 * The demo on one screen: Riley (the Tavus PAL) on the left, the Pine Computer on the right, and between them
 * every handoff as it happens. Under Riley, the presenter's next line; under the Computer, how far the job is.
 */
export function Demo() {
  const tavus = useTavus();
  const live = useLive(tavus.relay);
  usePageTools(tavus, live?.claim ?? null);
  const [operator, setOperator] = useState(false);
  const [captions, setCaptions] = useState(false);
  const [film, setFilm] = useState(false);

  useEffect(() => {
    const q = new URLSearchParams(location.search);
    setOperator(q.has("operator"));
    setCaptions(q.has("captions"));
    setFilm(q.has("film"));
  }, []);

  if (!live) return <div className="app" />;
  PAL.name = live.tavus.name || "Riley";
  const claim = live.claim;
  const turn = whoseTurn(claim, tavus);
  return (
    <div className={`app${film ? " film" : ""}`}>
      <div className="bar">
        <Mark />
        <h1>
          Pine Computer <span>×</span> Tavus <span>· a PAL that resolves the case</span>
        </h1>
        <div className="grow" />
        <span className="pill">
          <span className={`dot ${live.computer.state === "running" ? "on" : live.computer.state === "failed" ? "bad" : ""}`} />
          Computer · {live.computer.state === "running" ? "ready" : live.computer.state}
        </span>
        <button className="btn" onClick={() => setOperator((v) => !v)}>
          Operator
        </button>
      </div>
      <div className="stage">
        <CallPanel tavus={tavus} live={live} turn={turn} film={film} />
        <Bridge claim={claim} steps={live.steps} />
        <DesktopPanel live={live} working={claim?.state === "working"} />
        <Prompter tavus={tavus} live={live} />
        <Tracker claim={claim} steps={live.steps} progress={claim?.state === "working" ? live.progress : ""} />
      </div>
      {captions && <Caption lines={tavus.lines} />}
      {operator && <Operator live={live} tavus={tavus} />}
    </div>
  );
}

const DIGITS: Record<string, string> = { zero: "0", oh: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9" };

/** A serial number as heard: "AP3-4471-9026", "A P three, four four seven one…" all become AP3-4471-9026. */
function heardSerial(text: string): string | null {
  const flat = text
    .toLowerCase()
    .replace(/\b(zero|oh|one|two|three|four|five|six|seven|eight|nine)\b/g, (w) => DIGITS[w])
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  const m = flat.match(/AP3(\d{4})(\d{4})/);
  return m ? `AP3-${m[1]}-${m[2]}` : null;
}

/**
 * A built-in PAL (Charlie) has none of our tools, so the page calls them on its behalf from what the customer
 * says: a request for a claim starts one, a serial number answers that question, a yes approves. Each acts once.
 * With our own PAL ("pal" mode) the PAL calls the tools and this does nothing.
 */
function usePageTools(tavus: Tavus, claim: CaseView | null) {
  const current = useRef(claim);
  const acted = useRef(new Set<string>());
  current.current = claim;
  useEffect(() => {
    if (!claim) acted.current.clear(); // a new demo starts with a clean slate
  }, [claim]);
  tavus.onCustomer.current = (text: string) => {
    const c = current.current;
    const once = (key: string) => !acted.current.has(key) && !!acted.current.add(key);
    const tool = async (name: string, args: Record<string, string>) => {
      tavus.say({ role: "tool", text: `${name}(${Object.entries(args).map(([k, v]) => `${k}: ${v}`).join(", ")}) · from what the customer said` });
      const r = await post<{ output: string }>("/api/tool", { name, arguments: JSON.stringify(args) });
      tavus.say({ role: "tool", text: `→ ${r.output}` });
      tavus.context(`Claim task update, from the computer, not the customer: ${r.output}`);
    };
    if (!c) {
      if (!/warrant|claim|won.?t (turn|power)|not (turn|power)|stopped working|broken|replace|repair/i.test(text) || !once("start")) return;
      void tool(TOOLS.start, {
        product: /purifier|aero ?pure|ap3/i.test(text) ? "AeroPure 300 air purifier" : text.slice(0, 80),
        issue: /won.?t (turn|power)|not (turn|power)|power light/i.test(text) ? "won't power on" : "not working",
        details: text,
        resolution: /repair/i.test(text) ? "Repair" : "Replacement",
      });
    } else if (c.state === "needs_input" && c.questionKind === "info") {
      const serial = heardSerial(text);
      if (serial && once(`serial:${c.question}`)) void tool(TOOLS.answer, { answer: serial });
    } else if (c.state === "needs_input" && c.questionKind === "approval") {
      const no = /\b(no|don.?t|wait|stop|not yet|hold on)\b/i.test(text);
      const yes = /\b(yes|yeah|yep|sure|go ahead|submit|correct|right|please do|do it|sounds good)\b/i.test(text);
      if (yes && !no && once(`approve:${c.question}`)) void tool(TOOLS.answer, { answer: "Yes, submit it." });
      else if (no && once(`decline:${c.question}`)) void tool(TOOLS.answer, { answer: "No, don't submit it yet." });
    }
  };
}

/** Who acts next: the customer (amber on Riley's side) or the Computer (mint on its side). */
function whoseTurn(claim: CaseView | null, tavus: Tavus): "customer" | "computer" | "none" {
  if (claim?.state === "working") return "computer";
  if (claim?.state === "needs_input") return "customer";
  if (!claim && tavus.state === "live") return "customer";
  return "none";
}

// ---------- Riley ----------

function CallPanel({ tavus, live, turn, film }: { tavus: Tavus; live: Live; turn: string; film: boolean }) {
  // What was said, once each: a line can arrive twice, as it is heard and again when the turn is final.
  const spoken = tavus.lines.filter((l) => l.role === "pal" || l.role === "user").filter((l, i, all) => !i || all[i - 1].role !== l.role || all[i - 1].text !== l.text);
  const last = spoken[spoken.length - 1];
  return (
    <section className={`panel pal${turn === "customer" ? " yours" : ""}`}>
      <header>
        <span className="kick">{film ? `Tavus PAL · ${PAL.name}` : `Tavus PAL · ${PAL.name}, Larkspur Care`}</span>
        <div className="grow" />
        {tavus.state === "live" && (
          <span className="pill">
            <span className="dot on pulse" />
            On the call
          </span>
        )}
      </header>
      <div className="body">
        <div className="call" ref={tavus.container}>
          {tavus.state === "idle" && (
            <div className="idle">
              <b>{live.claim && live.claim.state !== "done" ? "The claim carries on without the call." : "A customer calls Larkspur Care."}</b>
              <span>{live.tavus.configured ? `${PAL.name} talks to the customer. The Computer does the work.` : "Add TAVUS_API_KEY and TAVUS_PAL_ID to .env.local."}</span>
              {tavus.error && <span className="err">{tavus.error}</span>}
            </div>
          )}
        </div>
        {/* The whole exchange, for scripted runs and debugging; the screen shows only the latest line. */}
        <ol className="transcript" hidden>
          {tavus.lines.map((l, i) => (
            <li key={i}>
              {{ user: "Customer", pal: "PAL", tool: "Tool", relay: "Relay" }[l.role]}
              {l.text}
            </li>
          ))}
        </ol>
      </div>
      {/* Below the call, never over it: the call's own mic and camera controls stay in reach. */}
      {/* ?film: the last two lines of the call, so the film reads with its sound off. */}
      {film && (
        <ol className="talk">
          {spoken.slice(-2).map((l, i) => (
            <li className={l.role} key={`${Math.max(0, spoken.length - 2) + i}:${l.text}`}>
              <b>{l.role === "pal" ? PAL.name : "Customer"}</b>
              {l.text}
            </li>
          ))}
        </ol>
      )}
      {!film && tavus.state === "live" && (
        <div className={`said-now ${last?.role ?? ""}`} key={last?.text ?? "none"}>
          <b>{last ? (last.role === "pal" ? PAL.name : "Customer") : PAL.name}</b>
          {last?.text ?? "…"}
        </div>
      )}
    </section>
  );
}

/** The presenter plays the customer: the next line to say, a button that says it, and the one action to take. */
function Prompter({ tavus, live }: { tavus: Tavus; live: Live }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const claim = live.claim;
  const callBack = tavus.calls >= 2; // the call in progress is counted: a second one is the call-back
  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const call = () =>
    run("Starting the Computer…", async () => {
      if (live.computer.state !== "running" || !live.computer.session) await post("/api/computer", { action: "prepare" });
      setBusy(`Calling ${PAL.name}…`);
      await tavus.start();
    });
  const fresh = () => run("Resetting…", () => post("/api/reset", {}));

  let say: string[] = [];
  let tip = "";
  let action: { label: string; go: () => void; kind?: string } | null = null;
  const onCall = tavus.state === "live";

  if (tavus.state === "starting") tip = "In the call window, allow your camera and microphone, then click Join.";
  else if (!claim) {
    if (onCall) {
      say = [`Hi ${PAL.name}. My AeroPure 300 air purifier won't turn on. Can you file a warranty claim? I'd like a replacement.`];
      tip = `${PAL.name} starts the claim, and the Computer gets to work on the right.`;
    } else {
      tip = "You play the customer, Jordan Lee. Start the call, allow your camera and microphone, then click Join.";
      action = { label: "Start the call", go: call, kind: "solid" };
    }
  } else if (claim.state === "working") {
    tip = onCall
      ? `The Computer is on it: signing in, reading the warranty, filling in the claim. ${PAL.name} will tell you when it needs you.`
      : "The Computer keeps working without the call. Call back any time.";
    if (!onCall) action = { label: "Call back", go: call, kind: "solid" };
  } else if (claim.state === "needs_input" && claim.questionKind === "approval") {
    if (onCall) {
      say = ["Yes, please submit it."];
      tip = "The claim is filled in on the review page. Nothing is submitted until you say yes.";
    } else {
      tip = "The claim is ready and waiting for your OK. Call back.";
      action = { label: "Call back", go: call, kind: "solid" };
    }
  } else if (claim.state === "needs_input") {
    if (onCall && !callBack) {
      say = ["Let me go find it. I'll call you back.", `It's ${SERIAL}.`];
      tip = `Hang up after ${PAL.name} answers: the claim waits, signed in and filled in. Or give the number now.`;
    } else if (onCall) {
      say = [`Yes, I found it. It's ${SERIAL}.`];
      tip = `${PAL.name} picked up where you left off. The number is on the label under the base.`;
    } else {
      tip = "The claim is waiting for the serial number, still signed in. Call back when you have it.";
      action = { label: "Call back", go: call, kind: "solid" };
    }
  } else if (claim.state === "done") {
    if (onCall) {
      say = [`Thanks, ${PAL.name}!`];
      tip = `${PAL.name} reads you the claim number. ${claim.verified ? "It's confirmed in Larkspur Care's own records." : ""}`;
    } else {
      tip = "Done. Start a new demo to run it again.";
      action = { label: "New demo", go: fresh };
    }
  } else {
    tip = "The claim stopped before it finished. Start a new demo.";
    if (!onCall) action = { label: "New demo", go: fresh };
  }
  if (onCall) action = { label: "Hang up", go: () => void tavus.end() };

  // ?film hides this panel, so a recording script starts and ends the call through these.
  useEffect(() => {
    (window as unknown as { __demo?: unknown }).__demo = { start: call, end: tavus.end };
  });

  return (
    <section className={`panel prompter${say.length ? " yours" : ""}`}>
      <header>
        <span className="kick">{say.length ? "Your line · you are Jordan" : "Next"}</span>
        <div className="grow" />
        {claim && !onCall && tavus.state === "idle" && claim.state !== "done" && (
          <button className="btn quiet" disabled={!!busy} onClick={fresh}>
            New demo
          </button>
        )}
        {action && (
          <button className={`btn ${action.kind ?? ""}`} disabled={!!busy || tavus.state === "starting" || (!live.tavus.configured && action.label !== "New demo")} onClick={action.go}>
            {busy ?? (tavus.state === "starting" ? "Joining…" : action.label)}
          </button>
        )}
      </header>
      <div className="body pr-body">
        {say.map((line, i) => (
          <div className={`pr-line${i ? " alt" : ""}`} key={line}>
            <q>{line}</q>
            <button className="btn quiet" onClick={() => tavus.type(line)} title="Types it into the call, as if you said it">
              Say it for me
            </button>
          </div>
        ))}
        {tip && <p className="pr-tip">{tip}</p>}
        {err && <p className="err">{err}</p>}
      </div>
    </section>
  );
}

// ---------- between them ----------

type Handoff = { at: string; dir: "right" | "left" | "check"; who: string; text: string; tone?: "you" | "done" };

function handoffs(claim: CaseView): Handoff[] {
  const out: Handoff[] = [];
  let asked: CaseView["questionKind"] | undefined;
  for (const e of claim.log) {
    if (e.who === "pal" || e.who === "operator")
      out.push({ at: e.at, dir: "right", who: `${PAL.name} → Computer`, text: `File a warranty claim: ${claim.request.product}, ${claim.request.issue.toLowerCase()}, ${claim.request.resolution.toLowerCase()}.` });
    else if (e.who === "customer") out.push({ at: e.at, dir: "right", who: asked === "approval" ? "Customer → Computer · approved" : "Customer → Computer", text: e.text });
    else if (e.who === "check") out.push({ at: e.at, dir: "check", who: "Larkspur Care", text: e.text, tone: "done" });
    else if (e.who === "computer") {
      const done = claim.state === "done" && e.text === claim.summary;
      asked = /\bsubmit\b/i.test(e.text) ? "approval" : "info";
      out.push(
        done
          ? { at: e.at, dir: "left", who: `Computer → ${PAL.name} · done`, text: e.text, tone: "done" }
          : { at: e.at, dir: "left", who: asked === "approval" ? `Computer → ${PAL.name} · needs approval` : `Computer → ${PAL.name} · needs the customer`, text: e.text, tone: "you" },
      );
    }
  }
  return out;
}

function Bridge({ claim, steps }: { claim: CaseView | null; steps: Step[] }) {
  const feed = useRef<HTMLDivElement>(null);
  const items = claim ? handoffs(claim) : [];
  useEffect(() => {
    feed.current?.scrollTo({ top: feed.current.scrollHeight, behavior: "smooth" });
  }, [items.length]);
  const now = [...steps].reverse().find((s) => s.state === "running") ?? steps[steps.length - 1];
  return (
    <section className="panel bridge">
      <header>
        <span className="kick">Between them</span>
      </header>
      <div className="body scroll" ref={feed}>
        {!claim ? (
          <div className="br-empty">
            <span className="br-arrows" aria-hidden="true">
              <i>→</i>
              <i>←</i>
            </span>
            <p>Every handoff shows here: what {PAL.name} asks the Computer to do, and what it needs back.</p>
          </div>
        ) : (
          <ol className="handoffs">
            {items.map((h, i) => (
              <li key={i} className={`ho ${h.dir} ${h.tone ?? ""}`}>
                <span className="ho-who">
                  {h.dir === "right" ? "→ " : h.dir === "left" ? "← " : "✓ "}
                  {h.who}
                  <time>{time(h.at)}</time>
                </span>
                <p>{h.text}</p>
              </li>
            ))}
            {claim.state === "working" && now && (
              <li className="ho working">
                <span className="ho-who">
                  <span className="dot on pulse" /> Computer working
                </span>
                <p>{now.title}</p>
              </li>
            )}
          </ol>
        )}
        {claim?.state === "done" && claim.claimNumber && (
          <div className="br-result">
            <span className="kick">Claim submitted{claim.verified ? " · confirmed" : ""}</span>
            <span className="num">{claim.claimNumber}</span>
            {claim.files.map((f) => (
              <a key={f.path} href={`/api/files/${f.path}`} target="_blank" rel="noreferrer">
                {f.name}
              </a>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

// ---------- the Computer ----------

function DesktopPanel({ live, working }: { live: Live; working: boolean }) {
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const driving = live.controller === "human" || live.controller === "user";
  const running = live.computer.state === "running" && !!live.computer.session;
  const onProblem = useCallback((t: string | null) => setProblem(t), []);
  const control = async (action: "take" | "release") => {
    setBusy(true);
    try {
      const r = await post<{ controller: string }>("/api/control", { action });
      live.controller = r.controller;
    } catch (e) {
      setProblem((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className={`panel computer${working ? " busy" : ""}`}>
      <header>
        <span className="kick">Pine Computer · live desktop</span>
        <span className="pill">
          <span className={`dot ${driving ? "you" : working ? "on pulse" : running ? "on" : ""}`} />
          {driving ? "A person has the controls" : working ? "Working" : running ? "Ready" : "Starts with the call"}
        </span>
        <div className="grow" />
        {running && (
          <button className={`btn ${driving ? "" : "amber"}`} disabled={busy} onClick={() => control(driving ? "release" : "take")}>
            {driving ? "Hand back" : "Take over"}
          </button>
        )}
      </header>
      <div className="body">
        <div className={`desk${driving ? " driving" : ""}`}>
          {running ? (
            <Desktop generation={live.computer.session ?? "on"} driving={driving} onProblem={onProblem} />
          ) : (
            <div className="idle">
              <span>The Computer starts when the call does.</span>
            </div>
          )}
        </div>
      </div>
      {problem && <div className="said err">{problem}</div>}
    </section>
  );
}

const STAGES = [
  { key: "order", label: "Find the order" },
  { key: "warranty", label: "Check the warranty" },
  { key: "form", label: "Fill in the claim" },
  { key: "serial", label: "Serial number", you: true },
  { key: "approval", label: "Approval", you: true },
  { key: "submit", label: "Submitted" },
] as const;

/** How far the job is, from the pages the agent reached and what it asked. */
function stages(claim: CaseView | null, steps: Step[]): Record<string, "done" | "now" | "you" | "todo"> {
  const pages = steps.map((s) => `${s.page ?? ""} ${s.title}`).join("\n");
  const asked = claim?.log.filter((e) => e.who === "computer").map((e) => e.text) ?? [];
  const waiting = (kind: "info" | "approval") => claim?.state === "needs_input" && claim.questionKind === kind;
  const done: Record<string, boolean> = {
    order: /Order LK-|View order/.test(pages),
    warranty: /warranty\.pdf|Limited Warranty|pdftotext/i.test(pages),
    form: /New warranty claim|Review your claim/.test(pages) || asked.length > 0,
    serial: asked.some((q) => /serial/i.test(q)) && !waiting("info"),
    approval: claim?.state === "done" || (asked.some((q) => /\bsubmit\b/i.test(q)) && !waiting("approval")),
    submit: claim?.state === "done",
  };
  const out: Record<string, "done" | "now" | "you" | "todo"> = {};
  let current = false;
  for (const s of STAGES) {
    if (done[s.key]) out[s.key] = "done";
    else if (!current && claim && (claim.state === "working" || claim.state === "needs_input")) {
      out[s.key] = claim.state === "needs_input" && "you" in s ? "you" : "now";
      current = true;
    } else out[s.key] = "todo";
  }
  return out;
}

function Tracker({ claim, steps, progress }: { claim: CaseView | null; steps: Step[]; progress: string }) {
  const st = stages(claim, steps);
  const now = [...steps].reverse().find((s) => s.state === "running") ?? steps[steps.length - 1];
  return (
    <section className="panel tracker">
      <header>
        <span className="kick">The job</span>
        <div className="grow" />
        {claim && claim.cost > 0 && <span className="meta">${claim.cost.toFixed(2)} so far</span>}
      </header>
      <div className="body">
        <ol className="stages">
          {STAGES.map((s) => (
            <li key={s.key} className={`st-${st[s.key]}`}>
              <i />
              <span>{s.label}</span>
              {"you" in s && <em>customer</em>}
            </li>
          ))}
        </ol>
        <p className="tr-now">
          {claim?.state === "working" && now ? (
            <>
              <span className="dot on pulse" /> {progress || now.title}
              {now.page && <span className="pg"> · {now.page}</span>}
            </>
          ) : claim?.state === "needs_input" ? (
            <>
              <span className="dot you" /> Waiting on the customer. The Computer holds its place, signed in.
            </>
          ) : claim?.state === "done" ? (
            <>
              <span className="dot on" /> Submitted{claim.verified ? ", and confirmed in Larkspur Care's records" : ""}.
            </>
          ) : (
            <span className="pg">{steps.length ? "" : "No job yet."}</span>
          )}
        </p>
      </div>
    </section>
  );
}

/** ?captions: the latest thing said on the call, large, for a recording or a loud room. */
function Caption({ lines }: { lines: Line[] }) {
  const last = [...lines].reverse().find((l) => l.role === "pal" || l.role === "user" || l.role === "relay");
  const [shown, setShown] = useState<Line | null>(null);
  useEffect(() => {
    if (!last) return;
    setShown(last);
    const t = setTimeout(() => setShown(null), Math.min(16000, 5000 + last.text.length * 45));
    return () => clearTimeout(t);
  }, [last]);
  if (!shown) return null;
  const who = shown.role === "pal" ? `${PAL.name} · Tavus PAL` : shown.role === "user" ? "Customer" : "Pine Computer → PAL";
  return (
    <div className={`caption ${shown.role}`} key={shown.text}>
      <b>{who}</b>
      <span>{shown.text}</span>
    </div>
  );
}

// ---------- the operator's fallbacks ----------

function Operator({ live, tavus }: { live: Live; tavus: Tavus }) {
  const [line, setLine] = useState("");
  const [answer, setAnswer] = useState("");
  const [signOut, setSignOut] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [out, setOut] = useState<string | null>(null);
  const act = async (fn: () => Promise<unknown>) => {
    setErr(null);
    try {
      const r = await fn();
      setOut(r && typeof r === "object" && "output" in r ? String((r as { output: string }).output) : null);
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const tool = (name: string, args: Record<string, string>) => post("/api/tool", { name, arguments: JSON.stringify(args), by: "operator" });
  return (
    <aside className="op">
      {tavus.state === "live" && (
        <section>
          <h3>Say as the customer</h3>
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              tavus.type(line);
              setLine("");
            }}
          >
            <input name="say" value={line} placeholder="Typed into the call as if spoken" onChange={(e) => setLine(e.target.value)} />
          </form>
        </section>
      )}
      <section>
        <h3>Run the PAL&apos;s tools without a call</h3>
        <div className="row">
          <button className="btn" onClick={() => act(() => tool(TOOLS.start, { product: "AeroPure 300 air purifier", issue: "It won't power on", details: "Stopped turning on two days ago; the power light doesn't come on.", resolution: "Replacement" }))}>
            start_warranty_claim
          </button>
          <button className="btn" onClick={() => act(() => tool(TOOLS.status, {}))}>
            get_claim_status
          </button>
        </div>
        <label>
          Answer the open question
          <input value={answer} placeholder={`${SERIAL} · Yes, submit it`} onChange={(e) => setAnswer(e.target.value)} />
        </label>
        <div className="row">
          <button className="btn" disabled={!answer} onClick={() => act(() => tool(TOOLS.answer, { answer }))}>
            answer_claim_question
          </button>
        </div>
      </section>
      <section>
        <h3>Computer and portal</h3>
        <div className="row">
          <button className="btn" onClick={() => act(() => post("/api/computer", { action: "prepare" }))}>
            Start
          </button>
          <button className="btn" onClick={() => act(() => post("/api/computer", { action: "stop" }))}>
            Stop
          </button>
          <button className="btn" onClick={() => act(() => post("/api/reset", { signOut }))}>
            Reset the case
          </button>
        </div>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" style={{ width: "auto" }} checked={signOut} onChange={(e) => setSignOut(e.target.checked)} /> Reset also signs every device out of the portal
        </label>
        <span className="note">
          {live.computer.state}
          {live.computer.stopAt ? ` · stops at ${time(live.computer.stopAt)} unless it works` : ""} ·{" "}
          <a href={live.portal.url} target="_blank" rel="noreferrer">
            the portal
          </a>
        </span>
      </section>
      {out && <span className="note">{out}</span>}
      {err && <span className="err">{err}</span>}
    </aside>
  );
}
