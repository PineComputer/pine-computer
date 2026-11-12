// The live desktop, for the person: pages on 127.0.0.1 that show what a Computer is doing and let them take
// the controls and hand them back. A Computer's page follows whichever of its conversations is working, so it
// can be pinned in a chat app; a conversation's page stays on that one. The pages get a short-lived desktop
// token for one session, never the project key or the Computer's credentials. Every address but the static
// viewer code carries a per-install key, so another page in the browser can't reach it.
//
// The pages are served by a process of their own (`pine-computer viewer`), started on first use and left
// running, so the links a chat app shows keep working after it closes the bridge process that posted them.
// `pine-computer serve` serves them itself, on its own origin, with the files the jobs made.

import { spawn } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, existingSession, bound, sessionsOf, type ComputerView } from "../core/computer.js";
import { at, log } from "../core/home.js";
import { inScope, local, scope, signature, type Scope } from "../core/store.js";
import { readThread, titlesOf } from "../core/thread.js";
import { page } from "./page.js";

const PORT = Number(process.env.PINE_VIEWER_PORT ?? 4777);
const ORIGIN = `http://127.0.0.1:${PORT}`;
/** The origin of a serve process that hosts the pages itself. */
let hosted: string | null = null;
/** On a service for many projects: a project's scope, from the name its links carry. */
let projects: ((project: string) => Scope) | null = null;

/** Pages and files are served by this process, at this origin. */
export function hostViewer(origin: string, scopeOf?: (project: string) => Scope): void {
  hosted = origin.replace(/\/+$/, "");
  projects = scopeOf ?? null;
}

/**
 * What a link starts with. On this machine, the install's key. For a project on a hosted service, the
 * project's name and a signature over what the link is for: one conversation's desktop, or one thread's
 * files. The link can be pasted into a chat, and reaches nothing else of the project's.
 */
async function grant(...names: string[]): Promise<string> {
  const project = scope()?.project;
  return project ? `${project}.${signature(project, ...names)}` : key();
}
const APP = "pine-computer-bridge";
const CLI = fileURLToPath(new URL("../cli.js", import.meta.url));
/** Which build serves the pages: a viewer left running from an older build is replaced. */
const BUILD = String(statSync(fileURLToPath(import.meta.url)).mtimeMs);

async function key(): Promise<string> {
  const saved = await local.get<{ key: string }>(["viewer"]);
  if (saved?.key) return saved.key;
  const fresh = randomBytes(12).toString("base64url");
  await local.set(["viewer"], { key: fresh });
  return fresh;
}

/** A Computer's page, or one conversation's when `session` is given. */
export async function viewerUrl(computer: string, session?: string): Promise<string> {
  const tail = session ? `/${encodeURIComponent(session)}` : "";
  return `${hosted ?? ORIGIN}/${await grant("desktop", computer, session ?? "")}/view/${encodeURIComponent(computer)}${tail}`;
}

/** A file a thread's job made, for a client that can't read this machine's disk. */
export async function fileUrl(threadId: string, name: string): Promise<string> {
  return `${hosted ?? ORIGIN}/${await grant("files", threadId)}/files/${encodeURIComponent(threadId)}/${encodeURIComponent(name)}`;
}

/** A reply's links to the job's files on this machine, as links the serve process hosts. */
export async function hostedLinks(text: string, threadId: string, files: { path: string; name: string }[]): Promise<string> {
  for (const f of files) text = text.split(pathToFileURL(f.path).href).join(await fileUrl(threadId, f.name));
  return text;
}

/** Makes sure the pages are served, starting a viewer process when none of this build runs. */
export async function ensureViewer(): Promise<void> {
  if (hosted) return;
  const running = await health();
  if (running?.build === BUILD) return;
  if (running) await fetch(`${ORIGIN}/${await key()}/api/quit`, { method: "POST" }).catch(() => undefined);
  spawn(process.execPath, [CLI, "viewer"], { detached: true, stdio: "ignore", env: process.env }).unref();
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 150));
    if ((await health())?.build === BUILD) return;
  }
  throw new Error(`The desktop page didn't start on port ${PORT}. Run \`pine-computer viewer\` to see why.`);
}

/** Serves the pages from this process until it exits. "running" when a viewer already holds the port. */
export async function serveViewer(): Promise<"started" | "running"> {
  const secret = await key();
  const server = createServer((req, res) => {
    handle(req, res, secret).catch((error) => {
      log("viewer:", error);
      send(res, 500, { error: (error as Error).message });
    });
  });
  // A viewer that is quitting may still hold the port for a moment.
  for (let attempt = 0; ; attempt++) {
    const listening = await new Promise<boolean>((resolve, reject) => {
      server.once("error", (error: NodeJS.ErrnoException) => (error.code === "EADDRINUSE" ? resolve(false) : reject(error)));
      server.listen(PORT, "127.0.0.1", () => resolve(true));
    });
    if (listening) return "started";
    const running = await health();
    if (running?.build === BUILD) return "running";
    if (attempt === 10) throw new Error(running ? `An older viewer holds port ${PORT}.` : `Port ${PORT} is taken by something else. Set PINE_VIEWER_PORT.`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

async function health(): Promise<{ build?: string } | null> {
  try {
    const r = await fetch(`${ORIGIN}/health`, { signal: AbortSignal.timeout(1_500) });
    const body = (await r.json()) as { app?: string; build?: string };
    return r.ok && body.app === APP ? body : null;
  } catch {
    return null;
  }
}

const webDir = path.dirname(fileURLToPath(import.meta.resolve("@pinesandbox/computer-web")));

/** The pages' routes, for a server that hosts them (`serve`). */
export async function handleViewer(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    await handle(req, res, projects ? null : await key());
  } catch (error) {
    log("viewer:", error);
    send(res, 500, { error: (error as Error).message });
  }
}

const TYPES: Record<string, string> = {
  ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
  ".svg": "image/svg+xml", ".txt": "text/plain; charset=utf-8", ".md": "text/markdown; charset=utf-8", ".csv": "text/csv; charset=utf-8",
  ".json": "application/json", ".html": "text/html; charset=utf-8", ".mp4": "video/mp4", ".mp3": "audio/mpeg", ".zip": "application/zip",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};
export const mediaType = (name: string) => TYPES[path.extname(name).toLowerCase()] ?? "application/octet-stream";

async function handle(req: IncomingMessage, res: ServerResponse, secret: string | null): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (url.pathname === "/health") return send(res, 200, { app: APP, build: BUILD });
  if (parts[0] === "web" && parts.length === 2 && /^[\w.-]+\.js(\.map)?$/.test(parts[1])) {
    const body = await readFile(path.join(webDir, parts[1])).catch(() => null);
    if (!body) return send(res, 404, { error: "Not found" });
    res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "max-age=3600" });
    return void res.end(body);
  }
  const [, kind, computer, session] = parts;
  const body = kind === "api" ? (req.method === "POST" ? await json(req) : Object.fromEntries(url.searchParams)) : {};

  // A project's link: it must be signed for exactly what this request reaches, and the rest runs as that project.
  const [project, signed] = (parts[0] ?? "").split(".");
  if (projects) {
    const names = kind === "files" ? ["files", computer ?? ""] : kind === "api" ? ["desktop", String(body.computer ?? ""), String(body.session ?? "")] : ["desktop", computer ?? "", session ?? ""];
    const expected = Buffer.from(project && signed ? signature(project, ...names) : "");
    if (!signed || expected.length !== signed.length || !timingSafeEqual(expected, Buffer.from(signed))) return send(res, 404, { error: "Not found" });
    return inScope(projects(project), () => route(req, res, parts, body, true));
  }
  if (parts[0] !== secret) return send(res, 404, { error: "Not found" });
  return route(req, res, parts, body, false);
}

/**
 * A Computer's state. A hosted process may not hold the project's key (it restarted, or the link reached another
 * one beside it); the Computer's own records still reach a conversation, so that conversation answers instead.
 */
async function stateOf(name: string, sessionName: string): Promise<ComputerView> {
  try {
    return await describe(name);
  } catch (error) {
    if (!scope()) throw error;
    const s = await existingSession(name, sessionName);
    const up = s ? await s.controlState().then(() => true, () => false) : false;
    return { name, state: up ? "running" : "stopped" };
  }
}

/** `one`: the link is for one conversation, so the page doesn't list the Computer's others. */
async function route(req: IncomingMessage, res: ServerResponse, parts: string[], body: Record<string, unknown>, one: boolean): Promise<void> {
  const [secret, kind, computer, session] = parts;

  if (req.method === "GET" && kind === "view" && computer) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    return void res.end(page({ computer, session, api: `/${secret}/api` }));
  }
  // Only a file the thread's history names is served, so the address can't reach anything else on disk.
  if (req.method === "GET" && kind === "files" && computer && session) {
    const thread = await readThread(computer);
    const file = thread?.history.flatMap((x) => x.files).findLast((f) => path.basename(f) === session);
    const body = file ? await readFile(file).catch(() => null) : null;
    if (!body) return send(res, 404, { error: "Not found" });
    res.writeHead(200, { "content-type": mediaType(session), "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(session)}`, "cache-control": "no-store" });
    return void res.end(body);
  }
  if (kind !== "api") return send(res, 404, { error: "Not found" });
  const name = String(body.computer ?? "");
  const sessionName = String(body.session ?? "");
  const action = parts[2];

  if (action === "quit" && req.method === "POST" && !hosted) {
    send(res, 200, { ok: true });
    return void setTimeout(() => process.exit(0), 50);
  }
  if (action === "conversations") {
    const [all, titles, view] = await Promise.all([sessionsOf(name), titlesOf(name), stateOf(name, sessionName)]);
    const sessions = one ? all.filter((s) => s.name === sessionName) : all;
    return send(res, 200, { state: view.state, conversations: sessions.map((s) => ({ ...s, title: titles.get(s.name) ?? "Conversation" })) });
  }
  if (action === "state") {
    const view = await stateOf(name, sessionName);
    const s = view.state === "running" ? await existingSession(name, sessionName) : null;
    const control = s ? await s.controlState().catch(() => null) : null;
    return send(res, 200, { ...view, open: !!s, controller: control?.controller ?? null });
  }
  if (req.method !== "POST") return send(res, 405, { error: "POST only" });
  const s = await existingSession(name, sessionName);
  if (!s) return send(res, 409, { error: "The computer is asleep. It wakes on the next message." });
  if (action === "desktop") {
    const found = await bound(name);
    return send(res, 200, (await found!.delegateDesktop(sessionName, { create: false })).toJSON());
  }
  if (action === "control") {
    const state = body.take ? await s.takeControl() : await s.releaseControl();
    return send(res, 200, { controller: state.controller });
  }
  return send(res, 404, { error: "Not found" });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function json(req: IncomingMessage): Promise<Record<string, unknown>> {
  let text = "";
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 10_000) throw new Error("Body too large");
  }
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}
