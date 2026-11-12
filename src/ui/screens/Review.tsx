import { Check, Pencil, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FileItem, ItemDecision, Note, ReviewItem, ReviewView, Verdict } from "../../shared/types.ts";
import { api, clock, useAction, useResource } from "../api.ts";
import { type TKey, useT } from "../i18n.ts";
import { errorText, fileKind, subjectName } from "../labels.ts";
import { Markdown } from "../Markdown.tsx";
import { Link, navigate } from "../router.tsx";
import { Still } from "../Still.tsx";
import { DocumentView, Pinboard, isDocument, isImage, isVideo, useShotList, useSize, variantLabel } from "../viewing.tsx";

type Drafts = Record<string, { verdict?: Verdict; notes: Note[] }>;

/**
 * State the maker builds up in a review, kept in this browser until the decision is sent,
 * so going on to the next review, or closing the window, doesn't lose it.
 */
function useDraft<V>(reviewId: string, name: string, initial: () => V): [V, (next: V | ((current: V) => V)) => void, () => void] {
  const key = `studio.draft.${reviewId}.${name}`;
  const [value, setValue] = useState<V>(() => {
    try {
      const saved = localStorage.getItem(key);
      if (saved !== null) return JSON.parse(saved) as V;
    } catch {
      // no storage: the draft lasts as long as the page
    }
    return initial();
  });
  const set = (next: V | ((current: V) => V)) =>
    setValue((current) => {
      const updated = typeof next === "function" ? (next as (current: V) => V)(current) : next;
      try {
        localStorage.setItem(key, JSON.stringify(updated));
      } catch {
        // not kept; it still works for this visit
      }
      return updated;
    });
  const clear = () => {
    try {
      localStorage.removeItem(key);
    } catch {
      // nothing was kept
    }
  };
  return [value, set, clear];
}

function Returned({ files }: { files: FileItem[] }) {
  const { t } = useT();
  if (!files.length) return null;
  return (
    <div className="block">
      <span className="label">{t("review.files")}</span>
      <div className="files">
        {files.map((file) => (
          <a key={file.id} href={file.url} target="_blank" rel="noreferrer" title={file.path}>
            <span className="kind">{fileKind(file.kind, t)}</span>
            <span>{[file.episode, file.subject, file.segment, file.version].filter(Boolean).join(" · ") || file.name}</span>
          </a>
        ))}
      </div>
    </div>
  );
}

/** The documents the agent returned or named (a rewritten screenplay, its review, a source), each readable in place. */
function Documents({ files }: { files: FileItem[] }) {
  const { t } = useT();
  if (!files.length) return null;
  return (
    <div className="block documents">
      <span className="label">{t("review.documents")}</span>
      {files.map((file, index) => (
        <details key={file.id} open={index === 0}>
          <summary title={file.path}>{file.name}</summary>
          <DocumentView file={file} />
        </details>
      ))}
    </div>
  );
}

function Status({ review }: { review: ReviewView }) {
  const { t } = useT();
  const resume = useAction(async () => {
    await api(`/api/reviews/${review.id}/resume`, { method: "POST" });
    navigate(`/d/${review.dramaId}`);
  });
  if (review.state === "saving" || review.state === "sending")
    return (
      <div className="status-line">
        <span className="dots">
          <i />
          <i />
          <i />
        </span>
        {t(review.state === "saving" ? "review.saving" : "review.sending")}
      </div>
    );
  if (review.state === "ended")
    return (
      <div className="status-line ended">
        <span className="grow">{t("review.ended")}</span>
        {review.episode && (
          <button className="link inherit" disabled={resume.busy} onClick={() => void resume.run()}>
            {t("review.continue")}
          </button>
        )}
        {resume.error !== undefined && <span className="error small">{errorText(resume.error, t)}</span>}
      </div>
    );
  if (review.state === "answered")
    return (
      <div className="status-line">
        <Check size={14} />
        {t("review.sent")}
      </div>
    );
  return null;
}

/** What the agent asked, as it wrote it: its links open the files the studio saved from that turn. */
function Said({ review, className }: { review: ReviewView; className: string }) {
  const files = [...review.reviewItems.flatMap((item) => item.files), ...review.otherFiles];
  return <Markdown text={review.question} links={new Map(files.map((file) => [file.path, file.url]))} className={`speech ${className}`} />;
}

/**
 * What the agent said, above the room: a few lines, so the pictures keep the screen, and the
 * whole of it a click away when it says more.
 */
function AgentSays({ review }: { review: ReviewView }) {
  const { t } = useT();
  const box = useRef<HTMLDivElement>(null);
  const [long, setLong] = useState(false);
  const [whole, setWhole] = useState(false);
  useEffect(() => {
    const said = box.current?.querySelector(".speech");
    if (said) setLong(said.scrollHeight > said.clientHeight + 4);
  }, [review.question]);
  return (
    <div ref={box} className={`agent-says ${whole ? "whole" : long ? "long" : ""}`}>
      <span className="label">{t("review.agent")}</span>
      <Said review={review} className="speech" />
      {(long || whole) && (
        <button className="link small more" onClick={() => setWhole((open) => !open)}>
          {t(whole ? "review.saysLess" : "review.saysMore")}
        </button>
      )}
    </div>
  );
}

function QuestionRoom({ review, done }: { review: ReviewView; done: () => void }) {
  const { t } = useT();
  const [answer, setAnswer, forget] = useDraft(review.id, "answer", () => review.decision?.words ?? "");
  const files = [...review.reviewItems.flatMap((item) => item.files), ...review.otherFiles];
  const open = review.state === "open";
  const send = useAction(async () => {
    await api(`/api/reviews/${review.id}/decision`, { method: "POST", json: { items: [], words: answer } });
    forget();
    done();
  });
  const finish = useAction(async () => {
    await api(`/api/episodes/${review.episodeId}/finish`, { method: "POST" });
    forget();
    done();
  });
  return (
    <main className="question">
      <Link to={`/d/${review.dramaId}`} className="crumb">
        ← {review.dramaTitle}
        {review.episode ? ` · ${review.episode}` : ""}
      </Link>
      <div className="question-body">
        <div className="block">
          <span className="label">{t("review.agent")}</span>
          <Said review={review} className="asked" />
        </div>
        {/* The pictures and the answer stay in view beside a long question. */}
        <div className="question-side">
          {files.some(isImage) && (
            <div className="plates">
              {files.filter(isImage).map((file) => (
                <a key={file.id} href={file.url} target="_blank" rel="noreferrer" title={file.path}>
                  <img src={file.url} alt={file.name} loading="lazy" />
                  <span className="cap">
                    {fileKind(file.kind, t)}
                    {[file.subject, file.segment, file.version].filter(Boolean).length > 0 && ` · ${[file.subject, file.segment, file.version].filter(Boolean).join(" ")}`}
                  </span>
                </a>
              ))}
            </div>
          )}
          <Status review={review} />
          <div className="field">
            <label className="label" htmlFor="answer">
              {t("review.answer")}
            </label>
            <textarea
              id="answer"
              className="box-area"
              autoFocus
              disabled={!open}
              value={open ? answer : review.answer ?? answer}
              onChange={(event) => setAnswer(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && answer.trim() && !send.busy) void send.run();
              }}
            />
          </div>
          {[send.error, finish.error].map((failed, n) => failed !== undefined && <p key={n} className="error">{errorText(failed, t)}</p>)}
          <div className="question-actions">
            {open && (
              <button className="btn ink" disabled={send.busy || !answer.trim()} onClick={() => void send.run()}>
                {t("review.sendAnswer")} <span className="key">⌘↵</span>
              </button>
            )}
            {review.finishable && review.episode && (
              <span className="finish">
                <button className="btn" disabled={finish.busy} onClick={() => void finish.run()}>
                  {t("review.finish", { code: review.episode })}
                </button>
                <span className="quiet small">{t("review.finishHint")}</span>
              </span>
            )}
          </div>
          {/* Documents last, so a long list doesn't push the answer out of view. */}
          <Documents files={files.filter((file) => !isImage(file) && isDocument(file))} />
          <Returned files={files.filter((file) => !isImage(file) && !isDocument(file))} />
        </div>
      </div>
    </main>
  );
}

function MediaRoom({ review, done }: { review: ReviewView; done: () => void }) {
  const { t } = useT();
  const items = review.reviewItems;
  const open = review.state === "open";
  const [index, setIndex] = useState(0);
  const [variant, setVariant] = useState(0);
  const [drafts, setDrafts, forgetDrafts] = useDraft<Drafts>(review.id, "items", () =>
    Object.fromEntries(
      items.map((item) => {
        const saved = review.decision?.items.find((decision) => decision.key === item.key);
        return [item.key, { verdict: saved?.verdict, notes: saved?.notes ?? [] }];
      }),
    ),
  );
  const [words, setWords, forgetWords] = useDraft(review.id, "words", () => review.decision?.words ?? "");
  const [noteText, setNoteText] = useState("");
  const [pending, setPending] = useState<{ x?: number; y?: number; time?: number; fileId?: number }>();
  // A picture for the note being written: a face to use, a costume, a place to match.
  const [picture, setPicture] = useState<FileItem>();
  const picker = useRef<HTMLInputElement>(null);
  const upload = useAction(async (chosen: File) => {
    const form = new FormData();
    form.set("file", chosen);
    setPicture(await api<FileItem>(`/api/dramas/${review.dramaId}/references`, { method: "POST", body: form }));
    noteInput.current?.focus();
  });
  const [confirming, setConfirming] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const noteInput = useRef<HTMLTextAreaElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  // Where the take or cut is, so "add a note at 0:02" says the time a note would get.
  const [playhead, setPlayhead] = useState(0);
  const stage = useRef<HTMLDivElement>(null);
  const stageSize = useSize(stage);

  const item: ReviewItem | undefined = items[index];
  const variants = item?.files ?? [];
  const file = variants[Math.min(variant, variants.length - 1)];
  const draft = item ? drafts[item.key] : undefined;
  // The earlier version beside the current one: the same variant where it has one.
  const before = comparing && file ? item?.previous?.find((p) => p.kind === file.kind && p.style === file.style) ?? item?.previous?.[0] : undefined;
  const space = before
    ? { width: Math.max(0, (stageSize.width - 40 - 24) / 2), height: Math.max(0, stageSize.height - 40 - 28) }
    : { width: Math.max(0, stageSize.width - 40), height: Math.max(0, stageSize.height - 40) };
  const shots = useShotList(
    review.breakdown ?? review.otherFiles.find((file) => file.kind === "breakdown" && /markdown|text/.test(file.type)),
    review.kind === "storyboards" || review.kind === "takes" ? item?.key : undefined,
  );
  const verdicts = items.map((i) => drafts[i.key]?.verdict);
  const approved = verdicts.filter((v) => v === "approve").length;
  const revise = verdicts.filter((v) => v === "revise").length;
  const left = items.length - approved - revise;
  const complete = items.length > 0 && left === 0;

  const update = (key: string, change: (value: Drafts[string]) => Drafts[string]) => setDrafts((current) => ({ ...current, [key]: change(current[key] ?? { notes: [] }) }));
  const setVerdict = (verdict: Verdict) => item && update(item.key, (value) => ({ ...value, verdict }));
  const go = (next: number) => {
    setIndex(Math.max(0, Math.min(items.length - 1, next)));
    setVariant(0);
    setPending(undefined);
  };

  const addNote = () => {
    if (!item || (!noteText.trim() && !picture)) return;
    const note: Note = { text: noteText.trim(), ...pending, ...(picture ? { image: picture.id } : {}) };
    update(item.key, (value) => ({ verdict: value.verdict ?? "revise", notes: [...value.notes, note] }));
    setNoteText("");
    setPending(undefined);
    setPicture(undefined);
  };

  const pin = (x: number, y: number) => {
    if (!open || !file) return;
    setPending({ x, y, fileId: file.id });
    noteInput.current?.focus();
  };

  const noteAtTime = () => {
    if (!open || !file) return;
    setPending({ time: video.current?.currentTime ?? 0, fileId: file.id });
    video.current?.pause();
    noteInput.current?.focus();
  };

  const send = async () => {
    setBusy(true);
    setError(undefined);
    const decision: { items: ItemDecision[]; words: string } = {
      words,
      items: items.map((i) => ({ key: i.key, verdict: drafts[i.key]?.verdict ?? "approve", notes: drafts[i.key]?.notes ?? [] })),
    };
    try {
      await api(`/api/reviews/${review.id}/decision`, { method: "POST", json: decision });
      forgetDrafts();
      forgetWords();
      done();
    } catch (reason) {
      setError(reason);
      setBusy(false);
      setConfirming(false);
    }
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        // The first ⌘↵ shows what will be sent; the second sends it.
        event.preventDefault();
        if (confirming && !busy) void send();
        else if (complete && open) setConfirming(true);
        return;
      }
      if (confirming) {
        if (event.key === "Escape") setConfirming(false);
        return;
      }
      const typing = event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement;
      if (typing) return;
      if (event.key === "j" || event.key === "ArrowRight") go(index + 1);
      else if (event.key === "k" || event.key === "ArrowLeft") go(index - 1);
      else if (event.key === "a" && open) {
        setVerdict("approve");
        if (index < items.length - 1) go(index + 1);
      } else if (event.key === "r" && open) {
        setVerdict("revise");
        event.preventDefault();
        noteInput.current?.focus();
      } else if (event.key === "c" && item?.previous?.length) {
        setComparing((on) => !on);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const labelOf = (i: ReviewItem) =>
    i.key === "cut" ? t("kind.cut") : /^(location|prop):/.test(i.key) && i.files[0] ? `${subjectName(i.label)} · ${fileKind(i.files[0].kind, t)}` : /^seg\d/i.test(i.key) ? i.label : subjectName(i.label);
  const thumbOf = (i: ReviewItem) => {
    const file = i.files.find(isImage) ?? i.files.find(isVideo);
    return file && { url: file.url, video: isVideo(file) };
  };
  const revisions = items.filter((i) => drafts[i.key]?.verdict === "revise");
  let pinNumber = 0;

  return (
    <div className="room">
      <div className="room-head">
        <Link to={`/d/${review.dramaId}`} className="crumb">
          ← {review.dramaTitle}
        </Link>
        <h1>
          {review.episode ? `${review.episode} · ` : ""}
          {t(`kind.${review.kind}` as TKey)}
        </h1>
        <span className="tally num">{t("review.tally", { a: approved, r: revise, left })}</span>
        <span className="spacer" />
        {open && (
          <button className="link" onClick={() => setDrafts((current) => Object.fromEntries(items.map((i) => [i.key, { ...current[i.key], verdict: "approve" }])))}>
            {t("review.approveAll")}
          </button>
        )}
        {review.nextId && (
          <button className="link" onClick={() => navigate(`/r/${review.nextId}`)}>
            {t("review.next")} →
          </button>
        )}
      </div>

      <AgentSays review={review} />

      <div className="room-body">
        <div className="viewing">
          <div className="variants">
            {variants.length > 1 &&
              variants.map((f, n) => (
                <button key={f.id} aria-pressed={n === variant} className={n === variant ? "on" : ""} onClick={() => setVariant(n)}>
                  {variantLabel(f, t)}
                </button>
              ))}
            <span className="grow" />
            {item?.previous?.length ? (
              <button aria-pressed={comparing} className={comparing ? "on" : ""} onClick={() => setComparing((on) => !on)}>
                {t("review.compare")} <span className="key">C</span>
              </button>
            ) : null}
          </div>
          <div className={`stage ${before ? "compare" : ""}`} ref={stage}>
            {before && (
              <div className="pane before">
                <span className="tag">
                  {t("review.before")} {before.version}
                </span>
                {isImage(before) && <Pinboard key={before.id} file={before} notes={item?.asked ?? []} space={space} onPin={() => undefined} />}
                {isVideo(before) && (
                  <div className="screen">
                    <video key={before.url} src={before.url} controls playsInline preload="metadata" />
                  </div>
                )}
              </div>
            )}
            <div className="pane">
              {before && (
                <span className="tag now">
                  {t("review.now")} {file?.version}
                </span>
              )}
              {file && isImage(file) && <Pinboard key={file.id} file={file} notes={draft?.notes ?? []} draft={pending?.fileId === file.id ? pending : undefined} space={space} onPin={pin} />}
              {file && isVideo(file) && (
                <div className="screen">
                  <video
                    ref={video}
                    key={file.url}
                    src={file.url}
                    controls
                    playsInline
                    preload="metadata"
                    onTimeUpdate={(event) => setPlayhead(event.currentTarget.currentTime)}
                    onSeeked={(event) => setPlayhead(event.currentTarget.currentTime)}
                    onLoadedMetadata={() => setPlayhead(0)}
                  />
                </div>
              )}
            </div>
          </div>
          <div className="reel">
            {items.map((i, n) => {
              const v = drafts[i.key]?.verdict;
              return (
                <button key={i.key} aria-current={n === index} className={n === index ? "on" : ""} onClick={() => go(n)}>
                  <div className="frame">
                    <Still still={thumbOf(i)} />
                  </div>
                  <div className="cap">
                    <span>{labelOf(i)}</span>
                    {v === "approve" && <Check size={13} className="v-approve" />}
                    {v === "revise" && <Pencil size={12} className="v-revise" />}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <aside className="inspector">
          <div className="inspector-head">
            <div className="item">
              <h2>{item && labelOf(item)}</h2>
              {file?.version && <span className="quiet num">{file.version}</span>}
            </div>
            <div className="verdict">
              <button aria-pressed={draft?.verdict === "approve"} className={`btn approve ${draft?.verdict === "approve" ? "on" : ""}`} disabled={!open} onClick={() => setVerdict("approve")}>
                {t("review.approve")} <span className="key">A</span>
              </button>
              <button aria-pressed={draft?.verdict === "revise"} className={`btn seal-btn ${draft?.verdict === "revise" ? "on" : ""}`} disabled={!open} onClick={() => setVerdict("revise")}>
                {t("review.revise")} <span className="key">R</span>
              </button>
            </div>
          </div>
          <div className="inspector-body">
            <Status review={review} />
            {item?.asked && (
              <div className="block asked-before">
                <span className="label">{t("review.askedBefore")}</span>
                <ol className="shots">
                  {item.asked.map((note, n) => (
                    <li key={n}>
                      {note.time !== undefined && <span className="at">{clock(note.time)} </span>}
                      {note.text}
                      {note.image !== undefined && (
                        <a className="note-picture" href={`/api/files/${note.image}`} target="_blank" rel="noreferrer">
                          <img src={`/api/files/${note.image}`} alt={t("review.picture")} />
                        </a>
                      )}
                    </li>
                  ))}
                </ol>
              </div>
            )}
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
            <div className="block">
              <span className="label">{t("review.notes")}</span>
              {(draft?.notes ?? []).length === 0 && (
                <span className="quiet small">
                  {file && isVideo(file) ? t("review.noNotesVideo") : t("review.noNotes")}
                </span>
              )}
              <div className="notes">
                {(draft?.notes ?? []).map((note, n) => {
                  const pinned = note.x !== undefined && note.fileId === file?.id;
                  if (pinned) pinNumber += 1;
                  return (
                    <div key={n} className="note">
                      <span className={`dot ${pinned ? "" : "plain"}`}>{pinned ? pinNumber : "·"}</span>
                      <div>
                        {note.time !== undefined && <div className="at">{clock(note.time)}</div>}
                        {note.text}
                        {note.image !== undefined && (
                          <a className="note-picture" href={`/api/files/${note.image}`} target="_blank" rel="noreferrer">
                            <img src={`/api/files/${note.image}`} alt={t("review.picture")} />
                          </a>
                        )}
                      </div>
                      {open && (
                        <button className="remove" aria-label={t("review.removeNote")} onClick={() => item && update(item.key, (value) => ({ ...value, notes: value.notes.filter((_, k) => k !== n) }))}>
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
              {open && (
                <>
                  {file && isVideo(file) && (
                    <button className="link start" onClick={noteAtTime}>
                      {t("review.noteAt", { time: clock(pending?.time ?? playhead) })}
                    </button>
                  )}
                  <textarea
                    ref={noteInput}
                    className="line-area"
                    value={noteText}
                    placeholder={pending?.x !== undefined ? t("review.noteHere") : t("review.notePlaceholder")}
                    onChange={(event) => setNoteText(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
                        event.preventDefault();
                        addNote();
                      }
                      if (event.key === "Escape") {
                        setPending(undefined);
                        (event.target as HTMLTextAreaElement).blur();
                      }
                    }}
                  />
                  <div className="note-tools">
                    {picture ? (
                      <span className="note-picture pending">
                        <img src={picture.url} alt={picture.name} />
                        <button className="link small" onClick={() => setPicture(undefined)}>
                          {t("review.removePicture")}
                        </button>
                      </span>
                    ) : (
                      <button className="link small" disabled={upload.busy} onClick={() => picker.current?.click()}>
                        {upload.busy ? t("review.addingPicture") : t("review.addPicture")}
                      </button>
                    )}
                    {(noteText.trim() || picture) && (
                      <button className="link small" onClick={addNote}>
                        {t("review.addNote")}
                      </button>
                    )}
                    <input
                      ref={picker}
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      hidden
                      onChange={(event) => {
                        const chosen = event.target.files?.[0];
                        event.target.value = "";
                        if (chosen) void upload.run(chosen);
                      }}
                    />
                  </div>
                  {upload.error !== undefined && <span className="error small">{errorText(upload.error, t)}</span>}
                </>
              )}
            </div>
            <Returned files={review.otherFiles} />
          </div>
        </aside>
      </div>

      {confirming ? (
        <div className="room-foot confirming">
          <div className="summary">
            <strong>{t("review.confirm")}</strong> {t("review.tally", { a: approved, r: revise, left })}
            {revisions.length > 0 && (
              <div className="detail">
                {revisions.map((i) => `${labelOf(i)}: ${(drafts[i.key]?.notes ?? []).map((note) => [note.text, note.image !== undefined ? `[${t("review.picture")}]` : ""].filter(Boolean).join(" ")).join("; ") || "—"}`).join(" · ")}
              </div>
            )}
          </div>
          <button className="link" onClick={() => setConfirming(false)}>
            {t("review.keep")}
          </button>
          <button className="btn ink" disabled={busy} onClick={send}>
            {t("review.sendNow")} <span className="key">⌘↵</span>
          </button>
        </div>
      ) : (
        <div className="room-foot">
          <input className="line-input words" disabled={!open} value={words} placeholder={t("review.wordsHint")} aria-label={t("review.words")} onChange={(event) => setWords(event.target.value)} />
          {error !== undefined && <span className="error">{errorText(error, t)}</span>}
          <button className="btn ink" disabled={!open || !complete || busy} onClick={() => setConfirming(true)} title={complete ? undefined : t("review.needVerdicts")}>
            {t("review.send")} <span className="key">⌘↵</span>
          </button>
        </div>
      )}
    </div>
  );
}

export function Review({ id }: { id: string }) {
  const { t } = useT();
  const { data, error } = useResource<ReviewView>(`/api/reviews/${id}`, ["inbox"]);
  const done = useMemo(
    () => () => {
      // On to the next review waiting, or back to the drama.
      void api<ReviewView>(`/api/reviews/${id}`).then((fresh) => navigate(fresh.nextId ? `/r/${fresh.nextId}` : `/d/${fresh.dramaId}`));
    },
    [id],
  );
  if (error !== undefined && !data) {
    return (
      <main className="page">
        <p className="error">{errorText(error, t)}</p>
      </main>
    );
  }
  if (!data) return <main className="page quiet">{t("loading")}</main>;
  return data.kind === "question" || data.reviewItems.length === 0 ? <QuestionRoom review={data} done={done} /> : <MediaRoom review={data} done={done} />;
}
