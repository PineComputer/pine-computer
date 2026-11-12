import { useState } from "react";
import type { FileItem, ScriptPage } from "../../shared/types.ts";
import { useResource } from "../api.ts";
import { useT } from "../i18n.ts";
import { errorText } from "../labels.ts";
import { SideBySide } from "../SideBySide.tsx";
import { DocumentView } from "../viewing.tsx";

/**
 * The drama as text: the screenplay as drama-cli recorded it (a rewrite beside the maker's original, and what it
 * changed), the screenplay as given, the bible, and every episode's breakdown, read only.
 */
export function Script({ dramaId }: { dramaId: string }) {
  const { t } = useT();
  const { data, error } = useResource<ScriptPage>(`/api/dramas/${dramaId}/script`, [`drama:${dramaId}`]);
  const [picked, setPicked] = useState<number>();
  if (error !== undefined && !data) return <p className="error">{errorText(error, t)}</p>;
  if (!data) return <p className="quiet">{t("loading")}</p>;
  const current = data.screenplay;
  const docs = [
    ...(current?.file
      ? [{ group: "screenplay", label: t(current.pending ? "script.pending" : "script.version", { version: current.version }), file: current.file }]
      : []),
    ...(current?.review ? [{ group: "screenplay", label: t("script.review", { version: current.version }), file: current.review }] : []),
    ...data.inputs.map((file) => ({ group: "inputs", label: file.name, file })),
    ...(data.bible ? [{ group: "bible", label: t("script.bible"), file: data.bible }] : []),
    ...data.breakdowns.map((entry) => ({ group: "episodes", label: entry.title ? `${entry.code} · ${entry.title}` : entry.code, file: entry.file })),
  ];
  const fallback = current?.pending ? docs.find((doc) => doc.group === "screenplay") : undefined;
  const shown =
    docs.find((doc) => doc.file.id === picked) ?? fallback ?? docs.find((doc) => doc.group === "bible") ?? docs.find((doc) => doc.group === "screenplay") ?? docs[0];
  // The screenplay the maker marked (a Word or PDF one as its text), to set beside a rewrite.
  const original: FileItem | undefined = data.inputs.find((file) => file.id === data.screenplayFile);
  const beside = shown?.file === current?.file && current?.file && original && original.id !== current.file.id;
  const groups: [string, string][] = [
    ["screenplay", t("script.current")],
    ["inputs", t("script.inputs")],
    ["bible", t("script.bible")],
    ["episodes", t("script.episodes")],
  ];
  return (
    <>
      <div className="work-head">
        <h2>{t("section.script")}</h2>
      </div>
      {!data.bible && !data.breakdowns.length && <p className="empty-note">{t("script.empty")}</p>}
      <div className="script">
        <nav className="script-nav">
          {groups.map(([group, label]) => {
            const items = docs.filter((doc) => doc.group === group);
            if (!items.length) return null;
            return (
              <div key={group} className="block">
                {group !== "bible" && <span className="label">{label}</span>}
                {items.map((doc) => (
                  <button key={doc.file.id} aria-current={doc === shown} className={doc === shown ? "on" : ""} onClick={() => setPicked(doc.file.id)}>
                    {doc.label}
                  </button>
                ))}
              </div>
            );
          })}
        </nav>
        <article className="script-page">
          {shown && beside && original ? (
            <>
              <p className="label">{t("script.sideBySide")}</p>
              <SideBySide left={<DocumentView key={original.id} file={original} />} right={<DocumentView key={shown.file.id} file={shown.file} />} />
            </>
          ) : (
            shown && <DocumentView key={shown.file.id} file={shown.file} />
          )}
        </article>
      </div>
    </>
  );
}
