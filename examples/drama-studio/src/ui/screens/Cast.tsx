import { Check, Pencil } from "lucide-react";
import { type CSSProperties, useState } from "react";
import type { CastCard, Receipt } from "../../shared/types.ts";
import { useResource } from "../api.ts";
import { useT } from "../i18n.ts";
import { errorText, subjectName } from "../labels.ts";
import { Link } from "../router.tsx";

/** One look (or a place, or a prop): its versions newest first, each with what the maker decided on it. */
function Look({ name, versions }: { name: string; versions: Receipt[] }) {
  const { t } = useT();
  const [index, setIndex] = useState(0);
  const [part, setPart] = useState(0);
  const shown = versions[Math.min(index, versions.length - 1)];
  const file = shown?.files[Math.min(part, shown.files.length - 1)];
  if (!file) return null;
  const verdict = shown.review?.verdict;
  return (
    <figure className="figure">
      <a className="frame" href={file.url} target="_blank" rel="noreferrer">
        <img src={file.url} alt={name} loading="lazy" />
      </a>
      <figcaption>
        <div className="caption">
          <span className="who">{name}</span>
          <span className="quiet small">{file.version}</span>
          {shown.files.length > 1 && (
            <span className="parts">
              {shown.files.map((candidate, n) => (
                <button key={candidate.id} aria-pressed={candidate === file} className={candidate === file ? "on" : ""} onClick={() => setPart(n)} aria-label={candidate.name}>
                  {n + 1}
                </button>
              ))}
            </span>
          )}
          {verdict === "approve" && <Check size={14} className="v-approve" aria-label={t("judged.approve")} />}
          {verdict === "revise" && <Pencil size={13} className="v-revise" aria-label={t("judged.revise")} />}
          {shown.review && (
            <Link to={`/r/${shown.review.reviewId}`} className="link small">
              {t("judged.open")}
            </Link>
          )}
        </div>
        {versions.length > 1 && (
          <div className="versions">
            {versions.map((version, i) => (
              <button
                key={version.turnId}
                aria-pressed={i === index}
                className={`${i === index ? "on" : ""} ${version.review?.verdict ?? ""}`}
                onClick={() => {
                  setIndex(i);
                  setPart(0);
                }}
              >
                {version.files[0]?.version ?? i + 1}
              </button>
            ))}
          </div>
        )}
      </figcaption>
    </figure>
  );
}

/** The episodes whose breakdowns name it, each a way to its page. */
function Appears({ card, dramaId }: { card: CastCard; dramaId: string }) {
  const { t } = useT();
  if (!card.episodes.length) return null;
  return (
    <div className="appears">
      <span className="quiet">{t("cast.in")}</span>
      {card.episodes.map((code) => (
        <Link key={code} to={`/d/${dramaId}/e/${code}`} className="link">
          {code}
        </Link>
      ))}
    </div>
  );
}

/** A character: the base look first, then each state (S1 wedding…), side by side. */
function Character({ card, dramaId }: { card: CastCard; dramaId: string }) {
  const { t } = useT();
  return (
    <section className="character" style={{ "--looks": card.looks.length } as CSSProperties}>
      <h4>{subjectName(card.subject)}</h4>
      <Appears card={card} dramaId={dramaId} />
      <div className="looks">
        {card.looks.map((look) => (
          <Look key={look.look} name={look.look === "base" ? t("cast.base") : look.look} versions={look.versions} />
        ))}
      </div>
    </section>
  );
}

export function Cast({ dramaId, compact = false }: { dramaId: string; compact?: boolean }) {
  const { t } = useT();
  const { data, error } = useResource<CastCard[]>(`/api/dramas/${dramaId}/cast`, [`drama:${dramaId}`]);
  const characters = (data ?? []).filter((card) => card.kind === "look");
  const places = (data ?? []).filter((card) => card.kind === "location");
  const props = (data ?? []).filter((card) => card.kind === "prop");
  return (
    <div>
      {!compact && (
        <div className="work-head">
          <h2>{t("section.cast")}</h2>
        </div>
      )}
      {!data ? (
        <p className={error === undefined ? "quiet" : "error"}>{error === undefined ? t("loading") : errorText(error, t)}</p>
      ) : !data.length ? (
        <p className="empty-note">{t("cast.empty")}</p>
      ) : (
        <div className="world">
          {characters.length > 0 && (
            <section>
              <h3>
                <span className="label">{t("cast.characters")}</span>
                <span className="faint num small">{characters.length}</span>
              </h3>
              <div className="characters">
                {characters.map((card) => (
                  <Character key={card.subject} card={card} dramaId={dramaId} />
                ))}
              </div>
            </section>
          )}
          {(
            [
              [places, t("cast.locations")],
              [props, t("cast.props")],
            ] as const
          ).map(([cards, label]) =>
            cards.length ? (
              <section key={label}>
                <h3>
                  <span className="label">{label}</span>
                  <span className="faint num small">{cards.length}</span>
                </h3>
                <div className="figures">
                  {cards.map((card) => (
                    <div key={card.subject}>
                      {card.looks.map((look) => (
                        <Look key={look.look} name={subjectName(look.look ? `${card.subject}/${look.look}` : card.subject)} versions={look.versions} />
                      ))}
                      <Appears card={card} dramaId={dramaId} />
                    </div>
                  ))}
                </div>
              </section>
            ) : null,
          )}
        </div>
      )}
    </div>
  );
}
