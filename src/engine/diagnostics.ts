// What a maker sends Pine when the studio misbehaves (Settings, Troubleshooting): the app and
// its Pine project, never the key; every drama down to its Computers, sessions, turns and
// reviews, with Pine's ids and the errors they met; what the agents said lately; and the
// engine's and the desktop shell's logs, updates included. No files and no sealed values.
// Pine's ids are what match its own logs to the studio's.
import os from "node:os";
import { appInfo } from "./connection.ts";
import { all } from "./db.ts";
import { logTail } from "./log.ts";

function clip(text: string | null, length: number): string | null {
  return text && text.length > length ? `${text.slice(0, length)}…` : text;
}

export function diagnostics() {
  return {
    madeAt: new Date().toISOString(),
    app: appInfo(),
    system: { platform: process.platform, arch: process.arch, release: os.release(), node: process.versions.node, electron: process.versions.electron },
    dramas: all("select id, title, status, note, reason, mode, rehearsal, format, length, parallel, per_computer, continues, created_at, updated_at from dramas order by created_at desc"),
    episodes: all("select id, drama_id, number, state, note, session_id, resume, continues, updated_at from episodes order by drama_id, number"),
    computers: all(
      "select id, drama_id, project, label, state, last_error, failures, idle_timeout, stop_by, revision, created_at, updated_at from computers order by created_at desc",
    ),
    sessions: all("select id, computer_id, drama_id, role, episode_id, state, task_id, created_at, closed_at from sessions order by created_at desc limit 300"),
    turns: all<{ question: string; summary: string }>(
      "select id, session_id, state, question, summary, cost, media, save_error, files_saved, settled, next_turn_id, created_at, ended_at from turns order by created_at desc limit 400",
    ).map((turn) => ({ ...turn, question: clip(turn.question, 600), summary: clip(turn.summary, 600) })),
    reviews: all<{ answer: string | null }>(
      "select id, drama_id, episode_id, session_id, turn_id, kind, state, answer, created_at, decided_at from reviews order by created_at desc limit 300",
    ).map((review) => ({ ...review, answer: clip(review.answer, 300) })),
    runs: all<{ goal: string }>("select key, session_id, kind, turn_id, goal, created_at from runs order by created_at desc limit 150").map((entry) => ({
      ...entry,
      goal: clip(entry.goal, 300),
    })),
    messages: all<{ text: string }>("select session_id, turn_id, kind, text, at from messages order by id desc limit 400").map((message) => ({
      ...message,
      text: clip(message.text, 400),
    })),
    logs: { engine: logTail("engine", 3000), desktop: logTail("desktop", 1000) },
  };
}
