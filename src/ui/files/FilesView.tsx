"use client";

import {
  ChevronRight,
  Download,
  File,
  FileArchive,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileText,
  Folder,
  HardDrive,
  MonitorOff,
  Paperclip,
  RefreshCw,
  Upload,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SessionView, TurnView, WorkFile } from "@/shared/api";
import { useApp } from "../app/AppProvider";
import { call, enc, errorText } from "../common/api";
import { kindOf, relative, size } from "../common/format";
import "./files.css";

const KINDS: [RegExp, LucideIcon][] = [
  [/\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)$/i, FileImage],
  [/\.(csv|tsv|xlsx?|ods|numbers)$/i, FileSpreadsheet],
  [/\.(zip|tar|gz|tgz|bz2|xz|7z|rar)$/i, FileArchive],
  [/\.(js|mjs|ts|tsx|jsx|py|rb|go|rs|java|sh|json|ya?ml|toml|html?|css|sql)$/i, FileCode],
  [/\.(md|txt|pdf|docx?|rtf|log|pptx?)$/i, FileText],
];
const iconFor = (name: string) => KINDS.find(([pattern]) => pattern.test(name))?.[1] ?? File;

/** A path's segments, each encoded, as the download routes read them. */
const segments = (path: string) => path.split("/").filter(Boolean).map(enc).join("/");

/** The live work directory of each session, and the copies this app keeps of what turns returned. */
export function FilesView() {
  const { app } = useApp();
  const sessions = app?.sessions ?? [];
  const [chosen, setChosen] = useState<string | null>(null);
  const session = sessions.find((s) => s.name === chosen) ?? sessions.find((s) => s.open) ?? sessions[0];

  return (
    <div className="page">
      <div className="page-in">
        <div className="page-head">
          <div>
            <h1>Files</h1>
            <p>Each session works in its own directory on the Computer. Browse it live, attach material for the agent, and keep what it returns.</p>
          </div>
        </div>

        {sessions.length > 1 ? (
          <div className="seg" role="tablist" aria-label="Session">
            {sessions.map((s) => (
              <button key={s.name} role="tab" aria-selected={s.name === session?.name} onClick={() => setChosen(s.name)}>
                <span className="dot" data-tone={s.working ? "agent" : s.open ? "ok" : undefined} />
                {s.label}
              </button>
            ))}
          </div>
        ) : null}

        {session ? <WorkDirectory key={session.name} session={session} /> : <NoComputer />}
        <Kept turns={app?.turns ?? []} sessions={sessions} />
      </div>
    </div>
  );
}

function NoComputer() {
  return (
    <section className="card">
      <div className="calm">
        <span className="ring">
          <HardDrive />
        </span>
        <b>No Computer yet</b>
        <p>Create one and each of its sessions gets a work directory you can browse here.</p>
      </div>
    </section>
  );
}

function WorkDirectory({ session }: { session: SessionView }) {
  const { toast } = useApp();
  const [folder, setFolder] = useState("");
  const [entries, setEntries] = useState<WorkFile[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const base = `/api/sessions/${enc(session.name)}`;

  const load = useCallback(async () => {
    if (!session.open) return;
    setLoading(true);
    try {
      setEntries(await call<WorkFile[]>(`${base}/files${folder ? `?path=${enc(folder)}` : ""}`));
      setProblem(null);
    } catch (error) {
      setProblem(errorText(error));
    } finally {
      setLoading(false);
    }
  }, [base, folder, session.open]);

  useEffect(() => {
    void load();
  }, [load]);

  const upload = async (files: FileList | File[]) => {
    const list = [...files];
    if (!list.length) return;
    setUploading(true);
    try {
      for (const file of list) {
        const form = new FormData();
        form.append("file", file);
        const { path } = await call<{ path: string }>(`${base}/files`, { body: form });
        toast({ tone: "done", text: `Attached ${path}` });
      }
      await load();
    } catch (error) {
      toast({ tone: "failed", title: "Couldn't attach that", text: errorText(error) });
    } finally {
      setUploading(false);
      if (picker.current) picker.current.value = "";
    }
  };

  if (!session.open) {
    return (
      <section className="card">
        <div className="calm">
          <span className="ring">
            <MonitorOff />
          </span>
          <b>{session.label} isn’t open</b>
          <p>Its work directory lives on the running Computer. Start the Computer to browse it; what earlier tasks returned is kept below.</p>
        </div>
      </section>
    );
  }

  const parts = folder.split("/").filter(Boolean);
  return (
    <section
      className="card workdir"
      data-dragging={dragging}
      onDragOver={(event) => {
        if (![...event.dataTransfer.types].includes("Files")) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        void upload(event.dataTransfer.files);
      }}
    >
      <div className="card-head">
        <nav className="crumbs" aria-label="Folder">
          <button aria-current={parts.length ? undefined : "location"} onClick={() => setFolder("")}>
            <HardDrive />
            Work directory
          </button>
          {parts.map((part, i) => (
            <span key={i} style={{ display: "contents" }}>
              <span className="sep">/</span>
              <button aria-current={i === parts.length - 1 ? "location" : undefined} onClick={() => setFolder(parts.slice(0, i + 1).join("/"))}>
                {part}
              </button>
            </span>
          ))}
        </nav>
        <div className="end">
          <button className="btn ghost icon sm" aria-label="Refresh" title="Refresh" disabled={loading} onClick={() => void load()}>
            <RefreshCw />
          </button>
        </div>
      </div>

      {problem ? (
        <div className="card-body">
          <p className="problem">{problem}</p>
        </div>
      ) : (
        <div className="rows">
          {entries === null ? (
            <div className="empty-note">
              <span className="spinner" style={{ display: "inline-block", verticalAlign: "middle" }} />
            </div>
          ) : entries.length === 0 ? (
            <div className="empty-note">{parts.length ? "This folder is empty." : "Nothing here yet. Files the agent makes, and ones you attach, show up here."}</div>
          ) : (
            entries.map((entry) => {
              if (entry.isDir) {
                return (
                  <button key={entry.path} className="row" onClick={() => setFolder(entry.path)}>
                    <span className="ico dir">
                      <Folder />
                    </span>
                    <span className="grow">
                      <span className="title">{entry.name}</span>
                    </span>
                    <span className="meta when">{entry.modifiedAt ? relative(Date.parse(entry.modifiedAt)) : ""}</span>
                    <ChevronRight className="go" />
                  </button>
                );
              }
              const Icon = iconFor(entry.name);
              return (
                <a key={entry.path} className="row" href={`${base}/files/${segments(entry.path)}`} download={entry.name} title={`Download ${entry.path}`}>
                  <span className="ico">
                    <Icon />
                  </span>
                  <span className="grow">
                    <span className="title">{entry.name}</span>
                  </span>
                  <span className="meta size">{size(entry.size)}</span>
                  <span className="meta when">{entry.modifiedAt ? relative(Date.parse(entry.modifiedAt)) : ""}</span>
                  <Download className="go" />
                </a>
              );
            })
          )}
        </div>
      )}

      <div className="drop">
        <span className="ico">
          <Paperclip />
        </span>
        <span>
          <b>Drop files to attach them</b>
          Attached files go to attachments/, which the agent reads as material. Up to 25 MB each.
        </span>
        <input ref={picker} type="file" multiple hidden onChange={(event) => event.target.files && void upload(event.target.files)} />
        <button className="btn sm" aria-busy={uploading} disabled={uploading} onClick={() => picker.current?.click()}>
          <Upload /> Attach
        </button>
      </div>
    </section>
  );
}

/** What finished turns returned, copied into this app: still here after the Computer stops. */
function Kept({ turns, sessions }: { turns: TurnView[]; sessions: SessionView[] }) {
  const kept = useMemo(
    () => turns.filter((t) => t.files?.length).sort((a, b) => Date.parse(b.askedAt) - Date.parse(a.askedAt)),
    [turns],
  );
  const label = (name: string) => sessions.find((s) => s.name === name)?.label ?? name;

  return (
    <section className="card">
      <div className="card-head">
        <h2>Kept by this app</h2>
        <span className="badge">{kept.length ? `${kept.length} ${kept.length === 1 ? "task" : "tasks"}` : "none yet"}</span>
      </div>
      <div className="card-body" style={{ paddingTop: 12, paddingBottom: 0 }}>
        <p className="muted" style={{ fontSize: 12.5 }}>
          When a task finishes, this app copies the files it returned into its own storage, so they stay downloadable after the Computer stops.
        </p>
      </div>
      {kept.length === 0 ? (
        <div className="empty-note">Files from finished tasks will collect here.</div>
      ) : (
        <div className="kept">
          {kept.map((turn) => (
            <div key={turn.turnId} className="kept-task">
              <header>
                <span className="ask" title={turn.ask}>
                  {turn.ask || (turn.kind === "schedule" ? "A scheduled task" : "A task")}
                </span>
                <span className="badge">{label(turn.session)}</span>
                <span className="when">{relative(Date.parse(turn.askedAt))}</span>
              </header>
              <ul className="files">
                {turn.files!.map((file) => {
                  const slash = file.path.lastIndexOf("/");
                  return (
                    <li key={file.path}>
                      <a href={`/api/turns/${enc(turn.turnId)}/files/${segments(file.path)}`} download={file.path.slice(slash + 1)}>
                        <span className="kind">{kindOf(file.path)}</span>
                        <span className="path">
                          {slash > 0 ? <span className="folder">{file.path.slice(0, slash + 1)}</span> : null}
                          {file.path.slice(slash + 1)}
                        </span>
                        <span className="size">{size(file.size)}</span>
                      </a>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
