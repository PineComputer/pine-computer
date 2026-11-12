import type { DeliveryRow, Judged } from "../../shared/types.ts";
import { useResource } from "../api.ts";
import { useT } from "../i18n.ts";
import { errorText } from "../labels.ts";
import { Link } from "../router.tsx";

function status(review: Judged | undefined): "approve" | "revise" | "waiting" | "none" {
  if (!review) return "none";
  if (review.state === "open" || review.state === "saving") return "waiting";
  return review.verdict ?? "none";
}

/**
 * What can be handed over: each episode's latest cut with its own review status, and the cut
 * the maker approved. Only an approved cut is offered as the episode's delivery; a review that
 * showed several cuts approves none of them in particular, and says so.
 */
export function Delivery({ dramaId }: { dramaId: string }) {
  const { t } = useT();
  const { data, error } = useResource<DeliveryRow[]>(`/api/dramas/${dramaId}/delivery`, [`drama:${dramaId}`]);
  if (error !== undefined && !data) return <p className="error">{errorText(error, t)}</p>;
  if (!data) return <p className="quiet">{t("loading")}</p>;
  const ready = data.filter((row) => row.accepted).length;
  return (
    <>
      <div className="work-head">
        <h2>{t("section.delivery")}</h2>
        {data.length > 0 && <span className="facts">{t("delivery.ready", { n: ready, total: data.length })}</span>}
        {ready > 0 && (
          <>
            <span className="spacer" />
            <a className="btn small ink" href={`/api/dramas/${dramaId}/season.zip`} download>
              {t("delivery.season", { n: ready })}
            </a>
          </>
        )}
      </div>
      {!data.length ? (
        <p className="empty-note">{t("delivery.empty")}</p>
      ) : (
        <table className="sheet delivery">
          <thead>
            <tr>
              <th>{t("board.episode")}</th>
              <th>{t("delivery.latest")}</th>
              <th>{t("delivery.accepted")}</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row) => {
              const latest = status(row.latest?.review);
              const group = (row.latest?.together ?? 1) > 1 && (latest === "approve" || latest === "revise");
              return (
                <tr key={row.code}>
                  <td>
                    <Link to={`/d/${dramaId}/e/${row.code}`} className="ep">
                      {row.code}
                    </Link>
                    {row.title && <div className="ep-title">{row.title}</div>}
                  </td>
                  <td>
                    {row.latest ? (
                      <div className="cut-line">
                        <span className="num">{row.latest.file.version ?? row.latest.file.name}</span>
                        <span className={`chip ${latest}`}>
                          {group ? t(latest === "approve" ? "delivery.groupApproved" : "delivery.groupRevised", { n: row.latest!.together }) : t(`delivery.status.${latest}`)}
                        </span>
                        <a className="link small" href={`${row.latest.file.url}&download=1`}>
                          {t("episode.download")}
                        </a>
                      </div>
                    ) : (
                      <span className="faint">{t("delivery.none")}</span>
                    )}
                  </td>
                  <td>
                    {row.accepted ? (
                      <a className="btn small ink" href={`${row.accepted.url}&download=1`}>
                        {t("episode.download")} {row.accepted.version}
                      </a>
                    ) : row.ambiguous ? (
                      <span className="quiet small">{t("delivery.ambiguous")}</span>
                    ) : (
                      <span className="faint">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}
