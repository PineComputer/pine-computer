// The viewer page: a Computer's live desktop, its state, and the controls handoff. Without a session it
// follows the work, showing whichever conversation is working (or was last); picking one keeps it there.
// Watching sends no input; the person drives only after taking the controls, and hands them back after.

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function page({ computer, session, api }: { computer: string; session?: string; api: string }): string {
  const data = JSON.stringify({ computer, session: session ?? null, api }).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(computer)} · Pine Computer</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' rx='3' fill='%23111613'/%3E%3Ccircle cx='8' cy='8' r='3' fill='%232fd892'/%3E%3C/svg%3E">
<style>
  :root { --ink: #111613; --raised: #171e1a; --line: #263029; --chalk: #eef0e8; --chalk-2: #a9b2ab; --mint: #2fd892; --amber: #e8b45a; --red: #f08a75; color-scheme: dark; }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body { background: var(--ink); color: var(--chalk); font: 14px/1.4 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; display: grid; grid-template-rows: auto 1fr auto; }
  header { display: flex; align-items: center; gap: 12px 16px; padding: 10px 16px; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
  .mark { width: 10px; height: 10px; border-radius: 50%; background: var(--chalk-2); flex: none; }
  .mark.on { background: var(--mint); box-shadow: 0 0 10px var(--mint); }
  .who { display: grid; gap: 2px; min-width: 0; flex: 1 1 200px; }
  .who b { font-weight: 600; letter-spacing: 0.01em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .who span, .note { font: 12px/1.4 ui-monospace, "SF Mono", Menlo, monospace; color: var(--chalk-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .who span.working { color: var(--mint); }
  select { font: inherit; color: var(--chalk); background: var(--raised); border: 1px solid var(--line); border-radius: 6px; padding: 7px 10px; max-width: 280px; }
  .chip { font: 12px ui-monospace, "SF Mono", Menlo, monospace; text-transform: uppercase; letter-spacing: 0.06em; padding: 4px 8px; border: 1px solid var(--line); border-radius: 4px; color: var(--chalk-2); white-space: nowrap; }
  .chip.human { color: var(--amber); border-color: var(--amber); }
  button { font: inherit; font-weight: 600; color: var(--ink); background: var(--chalk); border: 0; border-radius: 6px; padding: 8px 14px; cursor: pointer; white-space: nowrap; }
  button.ghost { background: transparent; color: var(--chalk); border: 1px solid var(--line); }
  button:disabled { opacity: 0.5; cursor: default; }
  main { position: relative; min-height: 0; background: #0b0f0d; }
  pine-desktop { position: absolute; inset: 0; display: block; }
  .empty { position: absolute; inset: 0; display: grid; place-items: center; text-align: center; padding: 24px; color: var(--chalk-2); }
  .empty p { max-width: 38ch; margin: 0; }
  footer { padding: 8px 16px; border-top: 1px solid var(--line); }
  footer .note.bad { color: var(--red); }
</style>
</head>
<body>
<header>
  <span class="mark" id="mark"></span>
  <div class="who"><b id="title">${escape(computer)}</b><span id="sub">Pine Computer</span></div>
  <select id="pick" aria-label="Which conversation to show" hidden></select>
  <span class="chip" id="chip">connecting</span>
  <button id="take" disabled>Take control</button>
  <button id="give" class="ghost" hidden>Hand back</button>
</header>
<main>
  <div class="empty" id="empty"><p>Connecting to the computer…</p></div>
</main>
<footer><span class="note" id="note">Watching. The computer keeps working while you watch.</span></footer>
<script type="module">
  import { connectionFromDelegation } from "/web/pine-computer.global.js";
  const { computer, session: pinned, api } = ${data};
  const $ = (id) => document.getElementById(id);
  const post = async (path, body) => {
    const r = await fetch(api + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ computer, session: current, ...body }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || r.statusText);
    return j;
  };
  const get = async (path, params) => (await fetch(api + path + "?" + new URLSearchParams({ computer, ...params }))).json();
  const note = (text, bad) => { $("note").textContent = text; $("note").className = bad ? "note bad" : "note"; };
  const empty = (text) => { $("empty").innerHTML = "<p></p>"; $("empty").firstChild.textContent = text; $("empty").hidden = false; };

  let chosen = pinned;
  let current = null;
  let el = null;
  let driving = false;
  let list = [];

  function drop() {
    el?.remove();
    el = null;
    current = null;
    driving = false;
  }

  async function show(session) {
    drop();
    current = session;
    empty("Connecting to the computer…");
    try {
      const first = connectionFromDelegation(await post("/desktop", {}));
      if (current !== session) return;
      let saved = first.token;
      el = document.createElement("pine-desktop");
      el.url = first.url;
      // Every connect, including a reconnect, asks for a fresh token.
      el.token = async () => { const t = saved; saved = null; return t ?? connectionFromDelegation(await post("/desktop", {})).token; };
      el.control = "view";
      el.addEventListener("pine-connected", () => { $("empty").hidden = true; });
      el.addEventListener("pine-error", (e) => note(String(e.detail?.error?.message ?? "The desktop connection failed."), true));
      document.querySelector("main").append(el);
    } catch (error) {
      if (current === session) { current = null; empty(error.message); }
    }
  }

  function render(state) {
    const pick = $("pick");
    const options = [["", "Follow the work"], ...list.map((c) => [c.name, c.title + (c.working ? " · working" : "")])];
    const value = chosen ?? "";
    pick.replaceChildren(...options.map(([v, label]) => Object.assign(document.createElement("option"), { value: v, textContent: label, selected: v === value })));
    pick.hidden = list.length < 2 && !chosen;
    const shown = list.find((c) => c.name === current);
    $("title").textContent = shown ? shown.title : computer;
    $("sub").textContent = shown ? computer + (shown.working ? " · working on it" : " · idle") : "Pine Computer";
    $("sub").className = shown?.working ? "working" : "";
    $("mark").className = state === "running" ? "mark on" : "mark";
  }

  let ticking = false;
  async function tick() {
    if (ticking) return;
    ticking = true;
    try {
      const { state, conversations } = await get("/conversations", { session: pinned ?? "" });
      list = conversations;
      const want = state !== "running" ? null : (chosen ?? list[0]?.name ?? null);
      // Never pull the screen away from a person who has the controls.
      if (want !== current && !driving) {
        if (want) await show(want);
        else {
          drop();
          empty(state === "running" ? "No conversations yet. Send the bot a job and its screen shows here." : "The computer is asleep. It wakes when a conversation sends it a job.");
        }
      }
      render(state);
      if (!current) {
        $("chip").textContent = state === "running" ? "idle" : "asleep";
        $("chip").className = "chip";
        $("take").disabled = true;
        $("take").hidden = false;
        $("give").hidden = true;
        return;
      }
      const s = await get("/state", { session: current });
      const human = s.controller === "human";
      $("chip").textContent = human ? "you have control" : "agent has control";
      $("chip").className = human ? "chip human" : "chip";
      $("take").disabled = !s.open;
      $("take").hidden = human;
      $("give").hidden = !human;
      if (human !== driving && el) { driving = human; el.control = human ? "drive" : "view"; }
    } catch {} finally {
      ticking = false;
    }
  }

  $("pick").onchange = () => { chosen = $("pick").value || null; tick(); };
  $("take").onclick = async () => {
    try { await post("/control", { take: true }); note("You have the controls. The agent waits until you hand back."); await tick(); }
    catch (error) { note(error.message, true); }
  };
  $("give").onclick = async () => {
    try { await post("/control", { take: false }); note("Handed back. The agent carries on from what's on the screen."); await tick(); }
    catch (error) { note(error.message, true); }
  };
  tick();
  setInterval(tick, 3000);
</script>
</body>
</html>`;
}
