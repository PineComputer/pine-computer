import type { ReviewSummary } from "../../shared/types.ts";
import { ago, useResource } from "../api.ts";
import { type TKey, useT } from "../i18n.ts";
import { plainText } from "../labels.ts";
import { Link } from "../router.tsx";
import { Still } from "../Still.tsx";

function Asks({ items, dramaId }: { items: ReviewSummary[]; dramaId?: string }) {
  const { t } = useT();
  return (
    <div className="queue">
      {items.map((item) => (
        <Link key={item.id} to={`/r/${item.id}`} className={`ask ${item.state === "ended" ? "ended" : ""}`}>
          <div className="thumb">
            <Still still={item.thumb} />
          </div>
          <div className="shrink">
            <div className="what">
              {t(`kind.${item.kind}` as TKey)}
              {item.episode && <span className="quiet"> · {item.episode}</span>}
            </div>
            <div className="where">
              {[!dramaId ? item.dramaTitle : null, item.items ? `${item.items}` : null].filter(Boolean).join(" · ")}
            </div>
            <div className="words">{plainText(item.question)}</div>
          </div>
          <div className="when">
            {item.state === "ended" ? t("inbox.ended") : item.state === "saving" ? "…" : <span className="seal-text">●</span>}
            <div className="num below">
              {ago(item.createdAt)}
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

/** What waits for the maker, then, apart, what ended before they decided (each can carry on in a new session). */
export function InboxList({ dramaId }: { dramaId?: string }) {
  const { t } = useT();
  const { data } = useResource<ReviewSummary[]>(dramaId ? `/api/inbox?drama=${dramaId}` : "/api/inbox", ["inbox"]);
  if (!data) return <p className="quiet">{t("loading")}</p>;
  const waiting = data.filter((item) => item.state !== "ended");
  const ended = data.filter((item) => item.state === "ended");
  return (
    <>
      {waiting.length ? <Asks items={waiting} dramaId={dramaId} /> : <p className="empty-note">{t("inbox.empty")}</p>}
      {ended.length > 0 && (
        <section className="ended-asks">
          <h3 className="label">{t("inbox.endedTitle")}</h3>
          <Asks items={ended} dramaId={dramaId} />
        </section>
      )}
    </>
  );
}

export function InboxScreen() {
  const { t } = useT();
  return (
    <main className="page">
      <div className="head">
        <h1>{t("inbox.title")}</h1>
      </div>
      <InboxList />
    </main>
  );
}
