// What happens when a turn ends: one that stops for the maker becomes a review; otherwise the
// setup lists the episodes and the drama goes into production, an episode finishes once its
// cut is accepted, and a turn that stops early or breaks off gets a bounded number of
// "continue" runs in the same session, where its files still are, then the maker is told.
// Reaching the maker resets the count.
import { classify, listedEpisodes } from "./classify.ts";
import { MAX_CONTINUES } from "./config.ts";
import { closeSession } from "./computers.ts";
import { all, get, newId, now, run } from "./db.ts";
import type { TurnInfo } from "./fleet.ts";
import { stopEvents } from "./follow.ts";
import type { Hints } from "./classify.ts";
import { inferKind, questionAsked, questionReady } from "./reviews.ts";
import { continueGoal } from "./goals.ts";
import { publish } from "./live.ts";
import { type ReviewRow, type SessionRow, drama as dramaRow, episode as episodeRow, episodeCode } from "./records.ts";
import { projectArchive, startRun } from "./runs.ts";

async function close(session: SessionRow) {
  stopEvents(session.id);
  await closeSession(session);
}

/** Whether the agent's last paragraph asks the maker something: a question, or a request to reply, review or approve. */
function asks(text: string): boolean {
  const last = text.trim().split(/\n\s*\n/).at(-1)?.trim() ?? "";
  return (
    /[?？][\s*_)）」”"']*$/.test(last) ||
    /\b(please|kindly)\s+(reply|respond|review|approve|confirm|let me know|tell me|decide|choose|watch|check)\b|\breply with\b|请(你)?(回复|答复|审阅|审批|审核|确认|批准|告诉我|决定|选择|观看|查看)/i.test(last)
  );
}

/**
 * Whether a turn that ended stops for the maker. A question does. So does a turn that finished
 * with something to review, or on a question: the agent may end its turn with the files and
 * its question in the summary rather than ask. Not the end of the work, though: the setup
 * handing over the project with its episodes, or an episode after its cut was accepted.
 */
export function stopsForMaker(session: SessionRow, info: TurnInfo): boolean {
  if (info.state === "needs_input") return true;
  if (info.state !== "completed") return false;
  const hints: Hints[] = info.files.map((file) => classify(file.path));
  // The setup packs the project only once the maker approved what it holds: that turn hands it over.
  if (session.role === "setup" && hints.some((hint) => hint.kind === "archive")) return false;
  if (session.role === "episode" && session.episode_id && cutAccepted(session.episode_id)) return false;
  return inferKind(session.role, hints) !== "question" || asks(info.summary);
}

/**
 * A turn that finished short of the next review, again after its "continue" runs: what the
 * agent said goes to the maker as a question (it is usually waiting on them in so many words),
 * rather than the work being called failed. Their answer is the session's next run.
 */
function askMaker(session: SessionRow, info: TurnInfo): void {
  questionAsked(session, info.turnId, info.summary);
  questionReady(session, info.turnId);
  if (session.role === "setup") run("update dramas set continues = 0 where id = ?", session.drama_id);
  else run("update episodes set continues = 0 where id = ?", session.episode_id);
}

export async function onEnded(session: SessionRow, info: TurnInfo, stop: boolean): Promise<void> {
  if (stop) {
    // The review waits for the maker; the work since the last one got somewhere.
    if (session.role === "setup") run("update dramas set continues = 0 where id = ?", session.drama_id);
    else run("update episodes set continues = 0 where id = ?", session.episode_id);
    return;
  }
  if (session.role === "setup") await setupEnded(session, info);
  else await episodeEnded(session, info);
  publish(`drama:${session.drama_id}`, "dramas", "inbox");
}

async function setupEnded(session: SessionRow, info: TurnInfo) {
  const drama = dramaRow(session.drama_id)!;
  if (info.state === "completed") {
    const listed = listedEpisodes(info.summary);
    // Episodes run on copies of the project pre-production packed: no project, no production.
    const packed = projectArchive(drama.id).length > 0;
    if (listed.length && packed) {
      for (const item of listed) {
        run(
          "insert into episodes (id, drama_id, number, title, state, updated_at) values (?, ?, ?, ?, 'queued', ?) on conflict(drama_id, number) do nothing",
          newId("ep"),
          drama.id,
          item.number,
          item.title,
          now(),
        );
      }
      // What pre-production made for an episode (its breakdown) belongs to it from now on.
      const byCode = new Map(all<{ id: string; number: number }>("select id, number from episodes where drama_id = ?", drama.id).map((row) => [episodeCode(row), row.id]));
      for (const file of all<{ id: number; rel_path: string }>("select id, rel_path from files where drama_id = ? and episode_id is null", drama.id)) {
        const episodeId = byCode.get(classify(file.rel_path).episode ?? "");
        if (episodeId) run("update files set episode_id = ? where id = ?", episodeId, file.id);
      }
      run("update dramas set status = 'production', note = '', updated_at = ? where id = ?", now(), drama.id);
      await close(session);
      return;
    }
    if (drama.continues >= MAX_CONTINUES) {
      askMaker(session, info);
      return;
    }
    run("update dramas set continues = continues + 1 where id = ?", drama.id);
    const missing = [
      packed ? "" : "Pack the whole drama/ folder, records included, into parts of at most 60 MB (`mkdir -p handoff && tar -cf - -C drama . | split -b 60m - handoff/project.tar.part-`) and return the parts.",
      listed.length ? "" : 'List the drama\'s episodes, one per line, as "EP001: <title>".',
    ];
    await startRun(session, "continue", missing.filter(Boolean).join(" "));
    return;
  } else if (info.state === "failed" && drama.continues < MAX_CONTINUES) {
    run("update dramas set continues = continues + 1 where id = ?", drama.id);
    await startRun(session, "continue", continueGoal(null, true));
    return;
  }
  run(
    "update dramas set status = 'stopped', note = ?, updated_at = ? where id = ?",
    info.summary ?? "",
    now(),
    drama.id,
  );
  await close(session);
}

function cutAccepted(episodeId: string): boolean {
  const last = get<ReviewRow>("select * from reviews where episode_id = ? order by created_at desc limit 1", episodeId);
  if (!last || last.kind !== "cut" || last.state !== "answered" || !last.decision) return false;
  const decision = JSON.parse(last.decision) as { items: { verdict: string }[] };
  return decision.items.length > 0 && decision.items.every((item) => item.verdict === "approve");
}

async function episodeEnded(session: SessionRow, info: TurnInfo) {
  const episode = session.episode_id ? episodeRow(session.episode_id) : undefined;
  if (!episode) return;
  if (info.state === "completed" && cutAccepted(episode.id)) {
    run("update episodes set state = 'done', note = '', session_id = null, updated_at = ? where id = ?", now(), episode.id);
    await close(session);
    return;
  }
  if ((info.state === "completed" || info.state === "failed") && episode.continues < MAX_CONTINUES) {
    run("update episodes set continues = continues + 1, updated_at = ? where id = ?", now(), episode.id);
    await startRun(session, "continue", continueGoal(episodeCode(episode), info.state === "failed"));
    return;
  }
  if (info.state === "completed") {
    askMaker(session, info);
    return;
  }
  run(
    "update episodes set state = 'failed', note = ?, session_id = null, updated_at = ? where id = ?",
    info.summary ?? "",
    now(),
    episode.id,
  );
  await close(session);
}
