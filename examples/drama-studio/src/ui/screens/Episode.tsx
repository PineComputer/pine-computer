import { Check, Pencil } from "lucide-react";
import { useRef, useState } from "react";
import { type EpisodePage, type Judged, type Receipt, STAGES } from "../../shared/types.ts";
import { api, useAction, useResource } from "../api.ts";
import { type TKey, useT } from "../i18n.ts";
import { errorText, fileKind, moneyText, nowText } from "../labels.ts";
import { Link } from "../router.tsx";
import { Still } from "../Still.tsx";
import { Pinboard, isImage, isVideo, useShotList, useSize, variantLabel } from "../viewing.tsx";

type Selection = { kind: "segment"; key: string; tab: "boards" | "stills" | "takes" } | { kind: "cut" } | { kind: "other" };

/** What the maker decided on what a review showed, with the way back to that review. */
function JudgedLine({ review }: { review?: Judged }) {
  const { t } = useT();
  if (!review) return <div className="judged quiet">{t("judged.none")}</div>;
  const link = (
    <Link to={`/r/${review.reviewId}`} className="link inherit">
      {t("judged.open")}
    </Link>
  );
  if (review.state === "open" || review.state === "saving") {
    return (
      <div className="judged waiting">
        {t("judged.waiting")} · {link}
      </div>
    );
  }
  if (review.verdict === "approve") {
    return (
      <div className="judged approved">
        <Check size={14} /> {t("judged.approve")} · {link}
      </div>
    );
  }
  if (review.verdict === "revise") {
    return (
      <div className="judged revised">
        <div>
          <Pencil size={13} /> {t("judged.revise")} · {link}
        </div>
        {review.notes.length > 0 && (
          <ol className="judged-notes">
            {review.notes.map((note, index) => (
              <li key={index}>{note.text}</li>
            ))}
          </ol>
        )}
      </div>
    );
  }
  return <div className="judged quiet">{t(review.state === "sending" ? "judged.sending" : "judged.ended")} · {link}</div>;
}

/** One receipt shown large: its pictures with the notes pinned on them, or its videos. */
function Viewer({ receipt }: { receipt: Receipt }) {
  const { t } = useT();
  const [variant, setVariant] = useState(0);
  const stage = useRef<HTMLDivElement>(null);
  const size = useSize(stage);
  const file = receipt.files[Math.min(variant, receipt.files.length - 1)];
  return (
    <div className="viewing episode-viewing">
      <div className="variants">
        {receipt.files.length > 1 &&
          receipt.files.map((candidate, index) => (
            <button key={candidate.id} aria-pressed={index === variant} className={index === variant ? "on" : ""} onClick={() => setVariant(index)}>
              {isVideo(candidate) ? candidate.version ?? candidate.name : variantLabel(candidate, t)}
            </button>
          ))}
        <span className="grow" />
        {file && (
          <a className="link" href={`${file.url}&download=1`}>
            {t("episode.download")}
          </a>
        )}
      </div>
      <div className="stage" ref={stage}>
        {file && isImage(file) && (
          <Pinboard key={file.id} file={file} notes={receipt.review?.notes ?? []} space={{ width: Math.max(0, size.width - 40), height: Math.max(0, size.height - 40) }} />
        )}
        {file && isVideo(file) && (
          <div className="screen">
            <video key={file.url} src={file.url} controls playsInline preload="metadata" />
          </div>
        )}
      </div>
    </div>
  );
}

/** A thing's receipts: the newest large, the earlier ones to pick from, each with its verdict. */
function Receipts({ receipts, empty }: { receipts: Receipt[]; empty: string }) {
  const { t } = useT();
  const [index, setIndex] = useState(0);
  const shown = receipts[Math.min(index, receipts.length - 1)];
  if (!shown) return <p className="empty-note">{empty}</p>;
  return (
    <div className="receipts">
      <Viewer key={shown.turnId} receipt={shown} />
      <JudgedLine review={shown.review} />
      {receipts.length > 1 && (
        <div className="history">
          <span className="label">{t("episode.history")}</span>
          {receipts.map((receipt, n) => (
            <button key={receipt.turnId} aria-pressed={n === index} className={n === index ? "on" : ""} onClick={() => setIndex(n)}>
              <span className="thumb">
                <Still still={receipt.files[0] && { url: receipt.files[0].url, video: isVideo(receipt.files[0]) }} />
              </span>
              <span className="num">{receipt.files[0]?.version ?? "—"}</span>
              {receipt.review?.verdict === "approve" && <Check size={13} className="v-approve" />}
              {receipt.review?.verdict === "revise" && <Pencil size={12} className="v-revise" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Episode({ dramaId, code }: { dramaId: string; code: string }) {
  const { t, lang } = useT();
  const { data: page, error } = useResource<EpisodePage>(`/api/dramas/${dramaId}/episodes/${code}`, [`drama:${dramaId}`]);
  const [picked, setPicked] = useState<Selection>();
  const resume = useAction(() => api(`/api/episodes/${page?.row.id}/resume`, { method: "POST" }));
  const selection: Selection | undefined =
    picked ?? (page?.cuts.length ? { kind: "cut" } : page?.segments[0] ? { kind: "segment", key: page.segments[0].key, tab: "boards" } : undefined);
  const segment = selection?.kind === "segment" ? page?.segments.find((candidate) => candidate.key === selection.key) : undefined;
  const shots = useShotList(page?.breakdown, segment?.key);

  if (error !== undefined && !page) return <p className="error">{errorText(error, t)}</p>;
  if (!page) return <p className="quiet">{t("loading")}</p>;
  const { row } = page;
  const trouble = row.state === "stopped" || row.state === "failed";
  const mark = (review?: Judged) => (review?.verdict === "approve" ? "approved" : review?.verdict === "revise" ? "revised" : review && (review.state === "open" || review.state === "saving") ? "waiting" : "");

  return (
    <div className="episode-page">
      <div className="episode-head">
        <Link to={`/d/${dramaId}`} className="back">
          ← {t("episode.back")}
        </Link>
        <div className="title-line">
          <h2>
            {row.code}
            {row.title && <span className="quiet"> · {row.title}</span>}
          </h2>
          <span className="grow" />
          {page.previous && (
            <Link to={`/d/${dramaId}/e/${page.previous}`} className="link">
              ← {page.previous}
            </Link>
          )}
          {page.next && (
            <Link to={`/d/${dramaId}/e/${page.next}`} className="link">
              {page.next} →
            </Link>
          )}
        </div>
        <div className="status-row">
          <div className="strip big" aria-hidden="true">
            {STAGES.map((stage) => (
              <span key={stage} className={row.stages[stage].state}>
                {t(`stage.${stage}` as TKey)}
              </span>
            ))}
          </div>
          <span className={`now ${row.state === "waiting" ? "waiting" : trouble ? "trouble" : ""}`}>{nowText(row, t)}</span>
          {row.spent.total > 0 && (
            <span className="spent num" title={t("spent.about")}>
              {moneyText(row.spent, t, lang)}
            </span>
          )}
          {row.reviewId && (
            <Link to={`/r/${row.reviewId}`} className="btn small seal-btn">
              {t("episode.review")} →
            </Link>
          )}
          {trouble && (
            <button className="btn small" disabled={resume.busy} onClick={() => void resume.run()}>
              {t("board.resume")}
            </button>
          )}
          {resume.error !== undefined && <span className="error small">{errorText(resume.error, t)}</span>}
        </div>
      </div>

      <div className="episode-body">
        <nav className="episode-nav" aria-label={t("episode.parts")}>
          {page.segments.map((candidate) => (
            <button
              key={candidate.key}
              aria-current={selection?.kind === "segment" && selection.key === candidate.key}
              className={selection?.kind === "segment" && selection.key === candidate.key ? "on" : ""}
              onClick={() => setPicked({ kind: "segment", key: candidate.key, tab: selection?.kind === "segment" ? selection.tab : "boards" })}
            >
              <span className="thumb">
                <Still still={(candidate.boards[0] ?? candidate.stills[0])?.files[0] && { url: (candidate.boards[0] ?? candidate.stills[0]).files[0].url }} />
              </span>
              <span className="name">{candidate.key}</span>
              <span className={`dot ${mark(candidate.takes[0]?.review ?? candidate.boards[0]?.review)}`} />
            </button>
          ))}
          <button aria-current={selection?.kind === "cut"} className={selection?.kind === "cut" ? "on" : ""} onClick={() => setPicked({ kind: "cut" })}>
            <span className="thumb">
              <Still still={page.cuts[0]?.files[0] && { url: page.cuts[0].files[0].url, video: true }} />
            </span>
            <span className="name">{t("episode.cut")}</span>
            <span className={`dot ${mark(page.cuts[0]?.review)}`} />
          </button>
          {page.other.length > 0 && (
            <button aria-current={selection?.kind === "other"} className={`other ${selection?.kind === "other" ? "on" : ""}`} onClick={() => setPicked({ kind: "other" })}>
              <span className="name">
                {t("episode.other")} <span className="quiet num">{page.other.length}</span>
              </span>
            </button>
          )}
        </nav>

        <section className="episode-view">
          {!selection && <p className="empty-note">{t("episode.nothing")}</p>}
          {selection?.kind === "segment" && segment && (
            <>
              <div className="views" role="group">
                {(["boards", "stills", "takes"] as const).map((tab) => (
                  <button key={tab} aria-pressed={selection.tab === tab} className={selection.tab === tab ? "on" : ""} onClick={() => setPicked({ ...selection, tab })}>
                    {t(`episode.${tab}`)} <span className="num">{segment[tab].length}</span>
                  </button>
                ))}
              </div>
              <div className="segment-view">
                <Receipts key={`${segment.key}-${selection.tab}`} receipts={segment[selection.tab]} empty={t("episode.nothing")} />
                {shots && (
                  <div className="block">
                    <span className="label">{t("review.shotList")}</span>
                    <ol className="shots">
                      {shots.map((shot) => (
                        <li key={shot}>{shot}</li>
                      ))}
                    </ol>
                  </div>
                )}
              </div>
            </>
          )}
          {selection?.kind === "cut" && <Receipts key="cut" receipts={page.cuts} empty={t("episode.noCut")} />}
          {selection?.kind === "other" && (
            <div className="files">
              {page.other.map((file) => (
                <a key={file.id} href={`${file.url}&download=1`} title={file.path}>
                  <span className="kind">{fileKind(file.kind, t)}</span>
                  <span>{file.path}</span>
                </a>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
