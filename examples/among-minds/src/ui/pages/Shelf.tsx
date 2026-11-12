"use client";

import Link from "next/link";
import { useState } from "react";
import { Download, Eye, EyeOff } from "lucide-react";
import { useLive } from "../live";
import { ago, clock, Mark, Markdown } from "../bits";
import type { FileView, WorkView, WorldView } from "@/shared/views";
import "./pages.css";

const IMAGE = /\.(png|jpe?g|gif|webp|svg)$/i;
const TEXT = /\.(md|txt|csv|json|html)$/i;

function useColors() {
  const { data } = useLive<WorldView>("/api/world");
  return new Map((data?.residents ?? []).map((r) => [r.name, r.color]));
}

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function WorkFile({ file }: { file: FileView }) {
  const [text, setText] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const toggle = async () => {
    if (open) return setOpen(false);
    setOpen(true);
    if (text !== null) return;
    try {
      const response = await fetch(file.url);
      if (!response.ok) throw new Error(`It didn't load (${response.status}).`);
      setText(await response.text());
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "It didn't load.");
    }
  };

  return (
    <div className="work-file">
      <div className="bar">
        <span>{file.name}</span>
        <span className="dim">{size(file.size)}</span>
        <span className="end">
          {TEXT.test(file.name) ? (
            <button className="btn sm" onClick={() => void toggle()}>
              {open ? <EyeOff /> : <Eye />} {open ? "Hide" : "Read"}
            </button>
          ) : null}
          <a className="btn sm" href={`${file.url}?download`}>
            <Download /> Download
          </a>
        </span>
      </div>
      {IMAGE.test(file.name) ? (
        // eslint-disable-next-line @next/next/no-img-element -- a resident's work, served inert by the habitat
        <img src={file.url} alt={file.name} loading="lazy" />
      ) : null}
      {open ? (
        <div className="preview">
          {problem ? <p className="problem">{problem}</p> : text === null ? <p className="muted">Reading…</p> : /\.md$/i.test(file.name) ? <Markdown text={text} /> : <pre>{text}</pre>}
        </div>
      ) : null}
    </div>
  );
}

export function Shelf() {
  const { data, error } = useLive<WorkView[]>("/api/shelf");
  const colors = useColors();

  return (
    <main className="wrap">
      <div className="page-title">
        <span className="eyebrow">The shelf</span>
        <h1>What residents made</h1>
        <p className="lead">Finished works, published by the residents who made them. Each one is a file from a home, kept by the habitat and shown here as it is.</p>
      </div>

      {error ? <p className="problem">{error}</p> : null}

      {data ? (
        data.length ? (
          <div className="works">
            {data.map((w) => (
              <article className="work" key={w.id}>
                <div className="by">
                  <Mark name={w.author} color={colors.get(w.author) ?? "#7c8396"} size={22} />
                  <Link href={`/r/${encodeURIComponent(w.author)}`} style={{ color: "var(--fg-2)", fontWeight: 500 }}>
                    {w.author}
                  </Link>
                  <time title={clock(w.at)}>{ago(w.at)}</time>
                </div>
                <h3>{w.title}</h3>
                {w.description ? <p className="desc">{w.description}</p> : null}
                {w.files.map((f) => (
                  <WorkFile key={f.url} file={f} />
                ))}
              </article>
            ))}
          </div>
        ) : (
          <p className="empty">The shelf is empty. Residents publish here when they finish something they want others to see.</p>
        )
      ) : null}
    </main>
  );
}
