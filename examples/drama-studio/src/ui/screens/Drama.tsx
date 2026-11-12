import { useState } from "react";
import type { AppInfo, DramaView } from "../../shared/types.ts";
import { api, useAction, useResource } from "../api.ts";
import { type TKey, useT } from "../i18n.ts";
import { errorText, kindLabel, moneyText } from "../labels.ts";
import { ReviewingChoice } from "../Reviewing.tsx";
import { Link } from "../router.tsx";
import { Board, SetupPanel } from "./Board.tsx";
import { Cast } from "./Cast.tsx";
import { Chat } from "./Chat.tsx";
import { Crew } from "./Crew.tsx";
import { Delivery } from "./Delivery.tsx";
import { Episode } from "./Episode.tsx";
import { Script } from "./Script.tsx";
import { InboxList } from "./Inbox.tsx";

const SECTIONS: [string, TKey][] = [
  ["board", "section.board"],
  ["script", "section.script"],
  ["cast", "section.cast"],
  ["delivery", "section.delivery"],
  ["crew", "section.crew"],
  ["inbox", "section.inbox"],
];

/** How many episodes run at once, and how many share a Computer: changed in place. Or the line stops. */
function Tune({ drama, onDone }: { drama: DramaView; onDone: () => void }) {
  const { t } = useT();
  const [parallel, setParallel] = useState(drama.parallel);
  const [perComputer, setPerComputer] = useState(drama.perComputer);
  const [reviewing, setReviewing] = useState(drama.reviewing);
  const [stopping, setStopping] = useState(false);
  const stop = useAction(async () => {
    await api(`/api/dramas/${drama.id}/stop`, { method: "POST" });
    onDone();
  });
  const save = async () => {
    await api(`/api/dramas/${drama.id}`, { method: "PATCH", json: { parallel, perComputer, reviewing } });
    onDone();
  };
  return (
    <div className="tune">
      <div className="field">
        <label className="label" htmlFor="parallel">
          {t("new.parallel")}
        </label>
        <input id="parallel" className="line-input num" type="number" min={1} max={50} value={parallel} onChange={(event) => setParallel(Number(event.target.value))} />
      </div>
      <div className="field">
        <span className="label">{t("new.perComputer")}</span>
        <div className="options">
          {[1, 2, 3].map((n) => (
            <button key={n} aria-pressed={perComputer === n} className={perComputer === n ? "on" : ""} onClick={() => setPerComputer(n)}>
              {n}
            </button>
          ))}
        </div>
      </div>
      <ReviewingChoice value={reviewing} onChange={setReviewing} />
      <div className="tune-actions">
        <button className="btn ink small" onClick={save}>
          {t("tune.save")}
        </button>
        <button className="link" onClick={onDone}>
          {t("tune.cancel")}
        </button>
      </div>
      {(drama.status === "setup" || drama.status === "production") && (
        <div className="tune-stop">
          {stopping ? (
            <>
              <p className="small">{t("stop.confirm")}</p>
              <div className="tune-actions">
                <button className="btn small" disabled={stop.busy} onClick={() => void stop.run()}>
                  {t("stop.yes")}
                </button>
                <button className="link" onClick={() => setStopping(false)}>
                  {t("tune.cancel")}
                </button>
              </div>
              {stop.error !== undefined && <p className="error small">{errorText(stop.error, t)}</p>}
            </>
          ) : (
            <button className="link quiet" onClick={() => setStopping(true)}>
              {t("stop.drama")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** What holds the drama up that the maker should know: it belongs to the other mode, or its Computers won't start. */
function Notices({ drama }: { drama: DramaView }) {
  const { t } = useT();
  const app = useResource<AppInfo>("/api/app", ["app"]);
  const retry = useAction(() => api(`/api/dramas/${drama.id}/computers/retry`, { method: "POST" }));
  const again = useAction(() => api(`/api/dramas/${drama.id}/retry`, { method: "POST" }));
  const rehearse = useAction(() => api(`/api/dramas/${drama.id}/rehearse`, { method: "POST" }));
  // Held during production (the setup panel says so before there are episodes).
  const held = drama.status === "stopped" && drama.episodeRows.length > 0;
  const elsewhere = app.data !== undefined && app.data.mode !== "none" && app.data.mode !== drama.mode;
  return (
    <>
      {elsewhere && <p className="notice">{t(drama.mode === "replay" ? "otherMode.replayNote" : "otherMode.pineNote")}</p>}
      {drama.rehearsal && !elsewhere && <p className="notice quiet-notice">{t("rehearsal.note")}</p>}
      {drama.atLimit !== undefined && !drama.stalled && <p className="notice">{t("limit.note", { n: drama.atLimit })}</p>}
      {held && (
        <div className="notice trouble">
          <div>
            <strong>{drama.setup.reason ? t(`setup.held.${drama.setup.reason}`) : drama.setup.note ?? t("board.stopped")}</strong>
            {drama.setup.reason === "no-drama-skill" && <div className="why">{t("setup.rehearseHint")}</div>}
            {[again.error, rehearse.error].map((failed, n) => failed !== undefined && <div key={n} className="error small">{errorText(failed, t)}</div>)}
          </div>
          <span className="notice-actions">
            <button className="btn small" disabled={again.busy} onClick={() => void again.run()}>
              {t("setup.retry")}
            </button>
            {drama.setup.reason === "no-drama-skill" && (
              <button className="btn small" disabled={rehearse.busy} onClick={() => void rehearse.run()}>
                {t("setup.rehearse")}
              </button>
            )}
          </span>
        </div>
      )}
      {drama.stalled && (
        <div className="notice trouble">
          <div>
            <strong>{t("stalled.title")}</strong>
            <div className="why">
              {drama.stalled.computer}: {drama.stalled.error}
            </div>
            {retry.error !== undefined && <div className="error small">{errorText(retry.error, t)}</div>}
          </div>
          <button className="btn small" disabled={retry.busy} onClick={() => void retry.run()}>
            {t("stalled.retry")}
          </button>
        </div>
      )}
    </>
  );
}

export function Drama({ id, tab, episode }: { id: string; tab: string; episode?: string }) {
  const { t, lang } = useT();
  const { data: drama, error } = useResource<DramaView>(`/api/dramas/${id}`, [`drama:${id}`]);
  const [talking, setTalking] = useState(false);
  const [tuning, setTuning] = useState(false);

  if (error !== undefined && !drama) {
    return (
      <main className="page">
        <p className="error">{errorText(error, t)}</p>
      </main>
    );
  }
  if (!drama) return <main className="page quiet">{t("loading")}</main>;

  const { episodes } = drama;

  return (
    <div className="drama-page">
      <aside className="rail">
        <div>
          <Link to="/" className="back">
            ← {t("rail.back")}
          </Link>
          <h1>{drama.title}</h1>
          <div className="about">
            {[drama.format, kindLabel(drama, t)].filter(Boolean).join(" · ")}
            {drama.length && ` · ${t(`new.length${drama.length}` as TKey)}`}            {drama.rehearsal && <span className="rehearsal-tag">{t("rehearsal.tag")}</span>}
          </div>
        </div>
        <nav className="sections">
          {SECTIONS.map(([key, label], index) => (
            <Link key={key} to={key === "board" ? `/d/${id}` : `/d/${id}/${key}`} className={tab === key || (key === "board" && tab === "episode") ? "on" : ""} aria-current={tab === key ? "page" : undefined}>
              <span className="n">{String(index + 1).padStart(2, "0")}</span>
              <span className="name">{t(label)}</span>
              {key === "inbox" && drama.waiting > 0 ? <span className="count">{drama.waiting}</span> : <span />}
            </Link>
          ))}
        </nav>
        <div className="ledger">
          {drama.spent.total > 0 && (
            <div className="spent" title={t("spent.about")}>
              <div className="row">
                <span>{t("ledger.spent")}</span>
                <span className="num">{moneyText(drama.spent, t, lang)}</span>
              </div>
              {drama.spent.media > 0 && (
                <div className="row">
                  <span>{t("ledger.video")}</span>
                  <span className="num">{moneyText(drama.spent.media, t, lang)}</span>
                </div>
              )}
            </div>
          )}
          {episodes.total > 0 && (
            <>
              <div className="row">
                <span>{t("ledger.atWork")}</span>
                <span className="num">{episodes.working}</span>
              </div>
              <div className="row">
                <span>{t("ledger.waiting")}</span>
                <span className={`num ${episodes.waiting ? "seal-text" : ""}`}>{episodes.waiting}</span>
              </div>
              <div className="row">
                <span>{t("ledger.finished")}</span>
                <span className="num">
                  {episodes.done} / {episodes.total}
                </span>
              </div>
            </>
          )}
        </div>
        {tuning ? (
          <Tune drama={drama} onDone={() => setTuning(false)} />
        ) : (
          <div className="rail-actions">
            <button className="link" onClick={() => setTuning(true)}>
              {t("rail.tune")}:{" "}
              {episodes.total > 0 && drama.parallel >= episodes.total
                ? t("rail.tuneAll", { n: episodes.total, c: drama.perComputer })
                : t("rail.tuneValue", { p: drama.parallel, c: drama.perComputer })}
            </button>
            <button className="btn small" onClick={() => setTalking((open) => !open)}>
              {t("rail.talk")}
            </button>
          </div>
        )}
      </aside>

      <section>
        <Notices drama={drama} />
        {tab === "board" && (drama.status === "setup" || (drama.status === "stopped" && !drama.episodeRows.length) ? <SetupPanel drama={drama} /> : <Board drama={drama} />)}
        {tab === "episode" && episode && <Episode key={`${id}/${episode}`} dramaId={id} code={episode} />}
        {tab === "script" && <Script dramaId={id} />}
        {tab === "cast" && <Cast dramaId={id} />}
        {tab === "delivery" && <Delivery dramaId={id} />}
        {tab === "crew" && <Crew drama={drama} />}
        {tab === "inbox" && (
          <>
            <div className="work-head">
              <h2>{t("inbox.title")}</h2>
            </div>
            <InboxList dramaId={id} />
          </>
        )}
      </section>
      {talking && <Chat dramaId={id} onClose={() => setTalking(false)} />}
    </div>
  );
}
