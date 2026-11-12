// The engine's HTTP API for the UI: reads, the maker's actions, library files (with range
// requests, so video seeks), and one event stream that says what changed.
//
// Who may call it: it answers only on loopback; every API call needs this launch's token,
// which the studio's window gets once through /api/open and keeps as an HttpOnly cookie
// (other programs on the machine, and other local web pages, don't have it); and changes
// come only from the studio's own origin. Files the agents returned are served so they
// can't act as pages of the studio: unknown types download, and none may run scripts.
import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono, type Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { streamSSE } from "hono/streaming";
import type { ApiFailure, AppInfo, Decision, ErrorCode, LiveMessage } from "../shared/types.ts";
import { FIXTURES, UI_DIR } from "./config.ts";
import { appInfo, connectPine, disconnect, useReplay } from "./connection.ts";
import { retryStarts } from "./computers.ts";
import { DEFAULT_ENDPOINT } from "./settings.ts";
import { all } from "./db.ts";
import { chat, chooseInputs, createDrama, desktop, finishEpisode, rehearse, resumeEpisode, retrySetup, stopDrama, updateDrama } from "./dramas.ts";
import { StudioError } from "./errors.ts";
import { fileRow, openBlob, save, toItem } from "./library.ts";
import { subscribe } from "./live.ts";
import { drama as dramaRow, review as reviewRow, session as sessionRow, type SessionRow } from "./records.ts";
import { decide, resumeWithDecision } from "./reviews.ts";
import { castCards, deliveryRows, episodePage, scriptPage, seasonEntries } from "./browse.ts";
import { diagnostics } from "./diagnostics.ts";
import { zipLength, zipStream } from "./zip.ts";
import { chatView, dramaCards, dramaFiles, dramaView, inbox, reviewView } from "./views.ts";

const LOOPBACK = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/;

/** This launch's token. The desktop shell (or scripts/dev.mjs) may choose it; otherwise it is new each start. */
const TOKEN = process.env.STUDIO_TOKEN || randomBytes(24).toString("base64url");
const COOKIE = "studio";

/** The link that lets a window into the studio: the engine prints it, the desktop shell opens it. */
export function openLink(origin: string): string {
  return `${origin}/api/open?ticket=${TOKEN}`;
}

function isToken(value: string | undefined): boolean {
  if (!value) return false;
  const given = Buffer.from(value);
  const expected = Buffer.from(TOKEN);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function failure(code: ErrorCode, error: string, detail?: string): ApiFailure {
  return detail === undefined ? { code, error } : { code, error, detail };
}

function fail(c: Context, error: unknown) {
  if (error instanceof StudioError) return c.json(failure(error.code, error.message, error.detail), error.status as 400);
  console.error(error);
  return c.json(failure("internal", (error as Error).message ?? "Something went wrong."), 500);
}

/** Types a window may show as they are; text the agents write is shown as plain text; anything else downloads. */
const SHOWN = /^(image\/(png|jpeg|webp|gif|avif|svg\+xml)|video\/(mp4|webm|quicktime)|audio\/[\w.+-]+|text\/plain)$/;
const AS_TEXT = /^(text\/markdown|application\/json|text\/csv)$/;

function fileHeaders(row: { name: string; type: string; sha: string }, version: string | undefined, download: boolean): Record<string, string> {
  const type = row.type.split(";")[0].trim().toLowerCase();
  const shown = SHOWN.test(type) || AS_TEXT.test(type);
  const headers: Record<string, string> = {
    "Content-Type": SHOWN.test(type) ? row.type : AS_TEXT.test(type) ? "text/plain; charset=utf-8" : "application/octet-stream",
    "Accept-Ranges": "bytes",
    "Cache-Control": version === row.sha.slice(0, 16) ? "private, max-age=31536000, immutable" : "no-cache",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'",
    "Cross-Origin-Resource-Policy": "same-origin",
  };
  if (download || !shown) headers["Content-Disposition"] = `attachment; filename*=UTF-8''${encodeURIComponent(row.name)}`;
  return headers;
}

export function app(): Hono {
  const api = new Hono();

  api.use("*", async (c, next) => {
    const host = c.req.header("host") ?? "";
    if (!LOOPBACK.test(host)) return c.text("Not found", 404);
    // The UI's own files are public; the API is the studio's alone.
    if (!c.req.path.startsWith("/api/") || c.req.path === "/api/open") return next();
    if (!isToken(getCookie(c, COOKIE))) return c.json(failure("signed-out", "Open the studio from its own window, or from the link the engine printed."), 401);
    if (c.req.method !== "GET" && c.req.method !== "HEAD" && c.req.header("origin") !== `http://${host}`) {
      return c.json(failure("signed-out", "Changes come only from the studio's own pages."), 403);
    }
    await next();
  });

  // Exchanges the printed or shell-opened link for the cookie, then shows the studio.
  api.get("/api/open", (c) => {
    if (!isToken(c.req.query("ticket"))) return c.text("This link is from an earlier start of the studio. Use the one it printed this time.", 403);
    setCookie(c, COOKIE, TOKEN, { httpOnly: true, sameSite: "Strict", path: "/", maxAge: 60 * 60 * 24 * 400 });
    return c.redirect("/");
  });

  api.get("/api/app", (c) => c.json<AppInfo>(appInfo()));

  api.post("/api/connection/pine", async (c) => {
    try {
      const { endpoint, apiKey } = (await c.req.json()) as { endpoint?: string; apiKey?: string };
      return c.json(await connectPine({ endpoint: endpoint || DEFAULT_ENDPOINT, apiKey: apiKey ?? "" }));
    } catch (error) {
      return fail(c, error);
    }
  });

  api.post("/api/connection/replay", (c) => {
    try {
      return c.json(useReplay());
    } catch (error) {
      return fail(c, error);
    }
  });

  api.delete("/api/connection", async (c) => {
    try {
      return c.json(await disconnect());
    } catch (error) {
      return fail(c, error);
    }
  });

  api.get("/api/dramas", (c) => c.json(dramaCards()));

  /** The mode a new drama is made for: the one the studio is in. */
  const currentMode = () => {
    const mode = appInfo().mode;
    if (mode === "none") throw new StudioError("no-mode", "Connect a Pine project or choose replay first.", 409);
    return mode;
  };

  api.post("/api/dramas", async (c) => {
    try {
      const mode = currentMode();
      const body = await c.req.parseBody({ all: true });
      const field = (name: string) => String(body[name] ?? "");
      const uploads = ([] as unknown[]).concat(body.files ?? []).filter((value): value is File => value instanceof File);
      const id = await createDrama({
        title: field("title"),
        language: field("language"),
        format: field("format"),
        parallel: Number(field("parallel")) || 4,
        perComputer: Number(field("perComputer")) || 1,
        notes: field("notes"),
        length: field("length"),
        rehearsal: field("rehearsal") === "1",
        reviewing: field("reviewing"),
        preset: field("preset"),
        screenplayLanguage: field("screenplayLanguage"),
        // Its place among the files the form sends, as two files may share a name; "" is none.
        screenplay: field("screenplay") === "" ? -1 : Number(field("screenplay")),
        files: await Promise.all(uploads.map(async (file) => ({ name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) }))),
      }, mode);
      return c.json({ id });
    } catch (error) {
      return fail(c, error);
    }
  });

  // A drama from the bundled sample screenplay, so the studio can be tried in one click: played
  // back in replay, and on a Pine project rehearsed, with Pine's agent standing in for the skill.
  api.post("/api/dramas/sample", async (c) => {
    try {
      const mode = currentMode();
      const { language } = (await c.req.json().catch(() => ({}))) as { language?: string };
      const zh = language !== "en";
      const name = `sample-screenplay.${zh ? "zh" : "en"}.md`;
      const id = await createDrama({
        title: zh ? "后妈来了" : "The Stepmother",
        language: zh ? "zh" : "en",
        format: "9:16, 480p",
        parallel: 3,
        perComputer: 1,
        notes: "",
        length: "60",
        files: [{ name, type: "text/markdown", bytes: readFileSync(path.join(FIXTURES, name)) }],
        rehearsal: mode === "pine",
        preset: mode === "pine" ? "" : zh ? "zh-cn-live-sfw" : "en-us-live-sfw",
        screenplayLanguage: zh ? "zh" : "en",
        screenplay: 0,
      }, mode);
      return c.json({ id });
    } catch (error) {
      return fail(c, error);
    }
  });

  api.get("/api/dramas/:id", (c) => {
    const drama = dramaRow(c.req.param("id"));
    return drama ? c.json(dramaView(drama)) : c.json(failure("not-found", "No such drama."), 404);
  });

  api.patch("/api/dramas/:id", async (c) => {
    try {
      updateDrama(c.req.param("id"), await c.req.json());
      return c.json(dramaView(dramaRow(c.req.param("id"))!));
    } catch (error) {
      return fail(c, error);
    }
  });

  api.post("/api/dramas/:id/retry", (c) => {
    try {
      retrySetup(c.req.param("id"));
      return c.json({ ok: true });
    } catch (error) {
      return fail(c, error);
    }
  });

  api.post("/api/dramas/:id/stop", async (c) => {
    try {
      await stopDrama(c.req.param("id"));
      return c.json({ ok: true });
    } catch (error) {
      return fail(c, error);
    }
  });

  api.post("/api/dramas/:id/inputs", async (c) => {
    try {
      await chooseInputs(c.req.param("id"), await c.req.json());
      return c.json(dramaView(dramaRow(c.req.param("id"))!));
    } catch (error) {
      return fail(c, error);
    }
  });

  api.post("/api/dramas/:id/rehearse", (c) => {
    try {
      rehearse(c.req.param("id"));
      return c.json({ ok: true });
    } catch (error) {
      return fail(c, error);
    }
  });

  // After a drama's Computers wouldn't start: the maker says to try again.
  api.post("/api/dramas/:id/computers/retry", (c) => {
    retryStarts(c.req.param("id"));
    return c.json({ ok: true });
  });

  api.get("/api/dramas/:id/cast", (c) => c.json(castCards(c.req.param("id"))));
  api.get("/api/dramas/:id/script", (c) => c.json(scriptPage(c.req.param("id"))));
  api.get("/api/dramas/:id/delivery", (c) => c.json(deliveryRows(c.req.param("id"))));
  // Every approved cut in one download, streamed as it is read.
  // What a maker sends Pine when something goes wrong (diagnostics.ts).
  api.get("/api/diagnostics", (c) => {
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-");
    c.header("Content-Type", "application/json");
    c.header("Content-Disposition", `attachment; filename="pine-drama-diagnostics-${stamp}.json"`);
    c.header("Cache-Control", "no-store");
    return c.body(JSON.stringify(diagnostics(), null, 2));
  });

  api.get("/api/dramas/:id/season.zip", (c) => {
    const { title, entries } = seasonEntries(c.req.param("id"));
    if (!entries.length) return c.json(failure("nothing-delivered", "No cut is approved yet."), 404);
    c.header("Content-Type", "application/zip");
    c.header("Content-Length", String(zipLength(entries)));
    c.header("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(title)}.zip`);
    c.header("Cache-Control", "no-store");
    return c.body(zipStream(entries));
  });
  api.get("/api/dramas/:id/episodes/:code", (c) => {
    const page = episodePage(c.req.param("id"), c.req.param("code"));
    return page ? c.json(page) : c.json(failure("not-found", "No such episode."), 404);
  });
  // A picture the maker adds to a review note: a face to use, a costume, a place to match.
  api.post("/api/dramas/:id/references", async (c) => {
    try {
      const drama = dramaRow(c.req.param("id"));
      if (!drama) return c.json(failure("not-found", "No such drama."), 404);
      const body = await c.req.parseBody();
      const file = body.file;
      if (!(file instanceof File) || !/^image\/(png|jpeg|webp)$/.test(file.type)) throw new StudioError("not-an-image", "Add a PNG, JPEG or WebP picture.");
      if (file.size > 20 * 1024 * 1024) throw new StudioError("file-too-large", `${file.name} is over 20 MiB.`, 400, file.name);
      const id = await save(new Uint8Array(await file.arrayBuffer()), { dramaId: drama.id, relPath: `references/${file.name}`, type: file.type, kind: "reference" });
      return c.json(toItem(fileRow(id)!));
    } catch (error) {
      return fail(c, error);
    }
  });

  api.get("/api/dramas/:id/files", (c) => c.json(dramaFiles(c.req.param("id"), c.req.query("episode") || undefined)));

  api.get("/api/dramas/:id/sessions", (c) => {
    const rows = all<SessionRow>("select * from sessions where drama_id = ? and state = 'open' order by created_at", c.req.param("id"));
    return c.json(rows.map(chatView));
  });

  api.post("/api/episodes/:id/finish", async (c) => {
    try {
      await finishEpisode(c.req.param("id"));
      return c.json({ ok: true });
    } catch (error) {
      return fail(c, error);
    }
  });

  api.post("/api/episodes/:id/resume", (c) => {
    try {
      resumeEpisode(c.req.param("id"));
      return c.json({ ok: true });
    } catch (error) {
      return fail(c, error);
    }
  });

  api.get("/api/inbox", (c) => c.json(inbox(c.req.query("drama") || undefined)));

  api.get("/api/reviews/:id", (c) => {
    const review = reviewRow(c.req.param("id"));
    return review ? c.json(reviewView(review)) : c.json(failure("not-found", "No such review."), 404);
  });

  api.post("/api/reviews/:id/decision", async (c) => {
    try {
      const review = await decide(c.req.param("id"), (await c.req.json()) as Decision);
      return c.json(reviewView(review));
    } catch (error) {
      return fail(c, error);
    }
  });

  api.post("/api/reviews/:id/resume", (c) => {
    try {
      resumeWithDecision(c.req.param("id"));
      return c.json({ ok: true });
    } catch (error) {
      return fail(c, error);
    }
  });

  api.get("/api/sessions/:id/chat", (c) => {
    const session = sessionRow(c.req.param("id"));
    return session ? c.json(chatView(session)) : c.json(failure("not-found", "No such session."), 404);
  });

  api.post("/api/sessions/:id/chat", async (c) => {
    try {
      const { text } = (await c.req.json()) as { text: string };
      await chat(c.req.param("id"), text);
      return c.json(chatView(sessionRow(c.req.param("id"))!));
    } catch (error) {
      return fail(c, error);
    }
  });

  api.post("/api/sessions/:id/desktop", async (c) => {
    try {
      const connection = await desktop(c.req.param("id"));
      if (!connection) return c.json(failure("not-found", "There is no desktop to show in replay mode."), 404);
      c.header("Cache-Control", "no-store");
      return c.json(connection);
    } catch (error) {
      return fail(c, error);
    }
  });

  api.get("/api/files/:id", (c) => {
    const row = fileRow(Number(c.req.param("id")));
    if (!row) return c.json(failure("not-found", "No such file."), 404);
    const headers = fileHeaders(row, c.req.query("v"), Boolean(c.req.query("download")));
    const range = c.req.header("range")?.match(/^bytes=(\d*)-(\d*)$/);
    if (range && row.size > 0) {
      const start = range[1] ? Number(range[1]) : Math.max(0, row.size - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), row.size - 1) : row.size - 1;
      if (start > end || start >= row.size) return c.body(null, 416, { "Content-Range": `bytes */${row.size}` });
      return c.body(Readable.toWeb(openBlob(row, { start, end })) as ReadableStream, 206, {
        ...headers,
        "Content-Range": `bytes ${start}-${end}/${row.size}`,
        "Content-Length": String(end - start + 1),
      });
    }
    return c.body(Readable.toWeb(openBlob(row)) as ReadableStream, 200, { ...headers, "Content-Length": String(row.size) });
  });

  api.get("/api/live", (c) =>
    streamSSE(c, async (stream) => {
      const send = (message: LiveMessage) => void stream.writeSSE({ data: JSON.stringify(message) }).catch(() => undefined);
      send({ type: "hello" });
      const stop = subscribe(send);
      const keepAlive = setInterval(() => void stream.writeSSE({ event: "ping", data: "" }).catch(() => undefined), 20_000);
      await new Promise<void>((resolve) => stream.onAbort(resolve));
      clearInterval(keepAlive);
      stop();
    }),
  );

  api.all("/api/*", (c) => c.json(failure("not-found", "Not found."), 404));

  // The built UI, outside development (Vite serves it in development).
  if (existsSync(UI_DIR)) {
    api.use("/*", serveStatic({ root: UI_DIR }));
    api.get("*", serveStatic({ path: `${UI_DIR}/index.html` }));
  }

  return api;
}
