import type { AppInfo, DramaCard, Mode } from "../../shared/types.ts";
import { api, useAction, useResource } from "../api.ts";
import { useT } from "../i18n.ts";
import { errorText, kindLabel, moneyText } from "../labels.ts";
import { Link, navigate } from "../router.tsx";

const CJK = /[㐀-鿿]/;

/** A drama's poster: its title set as type, over its leads once the agent has drawn them. */
function Poster({ drama, mode }: { drama: DramaCard; mode?: Mode | "none" }) {
  const { t } = useT();
  const elsewhere = mode !== undefined && mode !== "none" && mode !== drama.mode;
  const stamp = elsewhere
    ? t(drama.mode === "replay" ? "otherMode.replay" : "otherMode.pine")
    : drama.status === "setup"
      ? t("drama.casting")
      : drama.status === "stopped"
        ? t("drama.stopped")
        : drama.status === "done"
          ? t("drama.finished")
          : undefined;
  const stamps = [drama.rehearsal ? t("rehearsal.tag") : undefined, stamp].filter(Boolean).join(" · ");
  return (
    <div className={`poster ${CJK.test(drama.title) ? "vertical" : ""} ${drama.cast.length ? "cast" : ""}`}>
      {drama.cast.length > 0 && (
        <div className="leads">
          {drama.cast.map((url) => (
            <span key={url} style={{ backgroundImage: `url(${url})` }} />
          ))}
        </div>
      )}
      <h3>{drama.title}</h3>
      <div className="foot">{stamps && <span className="stamp">{stamps}</span>}</div>
    </div>
  );
}

export function Slate() {
  const { t, lang } = useT();
  const { data, error } = useResource<DramaCard[]>("/api/dramas", ["dramas", "inbox"]);
  const app = useResource<AppInfo>("/api/app", ["app"]);
  const sample = useAction(async () => {
    const { id } = await api<{ id: string }>("/api/dramas/sample", { method: "POST", json: { language: lang } });
    navigate(`/d/${id}`);
  });
  const dramas = data ?? [];
  // On a project without the drama skill, the way to try the studio on Pine is a rehearsal.
  const noSkill = app.data?.mode === "pine" && app.data.dramaSkill === "missing";
  const producing = dramas.filter((drama) => drama.status === "setup" || drama.status === "production").length;
  const waiting = dramas.reduce((sum, drama) => sum + drama.waiting, 0);
  return (
    <main className="page">
      <div className="head">
        <h1>{t("slate.title")}</h1>
        {dramas.length > 0 && <span className="facts">{t("slate.facts", { a: producing, b: waiting })}</span>}
        <span className="spacer" />
        <Link to="/new" className="btn ink">
          {t("slate.new")}
        </Link>
      </div>
      {error !== undefined && <p className="error">{errorText(error, t)}</p>}
      {data && dramas.length === 0 && (
        <div className="first">
          <p className="empty-note">{t(noSkill ? "slate.noSkill" : "slate.empty")}</p>
          {(app.data?.mode === "replay" || noSkill) && (
            <button className="btn" disabled={sample.busy} onClick={() => void sample.run()}>
              {t(noSkill ? "slate.rehearseSample" : "slate.sample")}
            </button>
          )}
          {sample.error !== undefined && <p className="error small">{errorText(sample.error, t)}</p>}
        </div>
      )}
      {data && dramas.length > 0 && noSkill && (
        <div className="notice quiet-notice">
          <span>{t("slate.noSkill")}</span>
          <span className="notice-actions">
            {sample.error !== undefined && <span className="error small">{errorText(sample.error, t)}</span>}
            <button className="btn small" disabled={sample.busy} onClick={() => void sample.run()}>
              {t("slate.rehearseSample")}
            </button>
          </span>
        </div>
      )}
      <div className={`shelf ${dramas.length ? "" : "empty"}`}>
        {dramas.map((drama) => {
          const { total, done } = drama.episodes;
          return (
            <Link key={drama.id} to={`/d/${drama.id}`} className="drama">
              <Poster drama={drama} mode={app.data?.mode} />
              <div className="title">{drama.title}</div>
              <div className="line">
                {total > 0 ? `${t("drama.episodes", { done, total })} · ` : ""}
                {[drama.format.split(",")[0], kindLabel(drama, t)].filter(Boolean).join(" · ")}
                {drama.spent.total > 0 && ` · ${moneyText(drama.spent, t, lang)}`}
              </div>
              {total > 0 && (
                <div className="progress">
                  <span style={{ width: `${(done / total) * 100}%` }} />
                </div>
              )}
              {drama.waiting > 0 && <div className="needs">{t("drama.needs", { n: drama.waiting })}</div>}
            </Link>
          );
        })}
        <Link to="/new" className="add-drama">
          <div>
            <div className="plus">+</div>
            {t("slate.new")}
          </div>
        </Link>
      </div>
    </main>
  );
}
