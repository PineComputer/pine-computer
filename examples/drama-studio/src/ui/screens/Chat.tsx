import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ChatMessage, ChatView, FileItem } from "../../shared/types.ts";
import { api, useResource } from "../api.ts";
import { type TKey, useT } from "../i18n.ts";
import { errorText } from "../labels.ts";
import { Markdown } from "../Markdown.tsx";
import { Link } from "../router.tsx";

/** One line of a session: the agent's narration and steps, and what it was sent, each in its own form. */
function Said({ message, previous, links }: { message: ChatMessage; previous?: ChatMessage; links: Map<string, string> }) {
  const { t } = useT();
  // A step that only repeats the narration above it adds nothing.
  if (message.kind === "activity" && previous?.kind === "progress" && previous.text === message.text) return null;
  if (message.decision) {
    const { reviewId, kind, approved, revised } = message.decision;
    return (
      <Link to={`/r/${reviewId}`} className="said decision">
        {t("talk.decision", { kind: t(`kind.${kind}` as TKey), a: approved, r: revised })} →
      </Link>
    );
  }
  if (message.brief) {
    return (
      <details className="said brief">
        <summary>{t("talk.brief")}</summary>
        <div>{message.text}</div>
      </details>
    );
  }
  if (message.kind === "result" || message.kind === "question" || message.kind === "progress") {
    return <Markdown text={message.text} links={links} className={`said ${message.kind} speech`} />;
  }
  return <div className={`said ${message.kind}`}>{message.text}</div>;
}

/** The agents' narration and questions, per session, and a line to answer, steer or ask. */
export function Chat({ dramaId, onClose }: { dramaId: string; onClose: () => void }) {
  const { t } = useT();
  const sessions = useResource<ChatView[]>(`/api/dramas/${dramaId}/sessions`, [`drama:${dramaId}`]);
  const [selected, setSelected] = useState<string>();
  const active = selected ?? sessions.data?.[0]?.sessionId;
  const chat = useResource<ChatView>(active ? `/api/sessions/${active}/chat` : null, active ? [`session:${active}`] : []);
  // The files the studio saved, by their path in the session, so a path the agent writes opens the saved file.
  const files = useResource<FileItem[]>(`/api/dramas/${dramaId}/files`, [`drama:${dramaId}`]);
  const links = new Map((files.data ?? []).map((file) => [file.path, file.url]));
  const [text, setText] = useState("");
  const [error, setError] = useState<unknown>();
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" });
  }, [chat.data?.messages.length]);

  const send = async () => {
    if (!active || !text.trim()) return;
    setError(undefined);
    try {
      await api(`/api/sessions/${active}/chat`, { method: "POST", json: { text } });
      setText("");
      chat.reload();
    } catch (reason) {
      setError(reason);
    }
  };

  const placeholder = chat.data?.sends === "answer" ? t("talk.answer") : chat.data?.sends === "steer" ? t("talk.steer") : t("talk.run");

  // On the page itself, but out of the drama page's flow: an ancestor's entrance animation would pin a fixed drawer inside the column.
  return createPortal(
    <aside className="talk">
      <div className="talk-head">
        <h2>{t("talk.title")}</h2>
        <span className="grow" />
        <button className="link" onClick={onClose}>
          {t("talk.close")}
        </button>
      </div>
      <div className="talk-tabs">
        {(sessions.data ?? []).map((session) => (
          <button key={session.sessionId} aria-pressed={session.sessionId === active} className={`${session.sessionId === active ? "on" : ""} ${session.sends === "answer" ? "asks" : ""}`} onClick={() => setSelected(session.sessionId)}>
            {session.label || t("talk.setup")}
            {session.sends === "answer" || session.sends === "review" ? " ●" : ""}
          </button>
        ))}
      </div>
      <div className="lines" ref={list}>
        {!active && <p className="quiet">{t("talk.none")}</p>}
        {(chat.data?.messages ?? []).map((message, index, all) => (
          <Said key={message.id} message={message} previous={all[index - 1]} links={links} />
        ))}
      </div>
      <div className="talk-foot">
        {error !== undefined && <span className="error small">{errorText(error, t)}</span>}
        {chat.data?.sends === "review" && chat.data.reviewId ? (
          <Link to={`/r/${chat.data.reviewId}`} className="btn small">
            {t("talk.inReview")} →
          </Link>
        ) : (
        <div className="row">
          <textarea
            className="line-area"
            value={text}
            disabled={!active || chat.data?.sends === "none"}
            placeholder={placeholder}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void send();
            }}
          />
          <button className="btn ink small" disabled={!text.trim()} onClick={send}>
            {t("talk.send")}
          </button>
        </div>
        )}
      </div>
    </aside>,
    document.body,
  );
}
