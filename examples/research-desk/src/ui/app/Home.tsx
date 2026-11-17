"use client";

// The desk's front page: ask a question, or open a brief already asked.

import { ArrowUp } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { brand } from "@/brand";
import type { BriefSummary } from "@/shared/api";
import { call } from "../common/api";
import { ago, count } from "../common/format";
import { useDesk } from "./Desk";

const STATE: Record<BriefSummary["state"], string> = { planning: "Proposing angles", draft: "Angles ready", reading: "Reading", writing: "Writing the report", done: "Report", failed: "Stopped" };

/** A key the server can tell a repeated request by. */
export const newKey = () => crypto.randomUUID().replace(/-/g, "").slice(0, 24);

export function Home() {
  const { desk, act } = useDesk();
  const router = useRouter();
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);

  const ask = async (text: string) => {
    if (!text.trim() || busy) return;
    setBusy(true);
    const made = await act(() => call<{ id: string }>("/api/briefs", { body: { question: text.trim(), key: newKey() } }));
    if (made) router.push(`/b/${made.id}`);
    else setBusy(false);
  };

  return (
    <main className="home">
      <div className="home-in">
        <div className="home-head">
          <h1>What should the desk read up on?</h1>
          <p>Ask one question that takes reading across the web. Three Pine Computers each take an angle and read at the same time; you get one report whose every source is a page they opened.</p>
        </div>
        <form
          className="asker"
          onSubmit={(event) => {
            event.preventDefault();
            void ask(question);
          }}
        >
          <textarea
            aria-label="Your question"
            placeholder="Compare, explain or survey something, and say which sources you trust"
            rows={2}
            value={question}
            autoFocus
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void ask(question);
              }
            }}
          />
          <button className="btn primary" disabled={!question.trim() || busy} aria-busy={busy}>
            Ask <ArrowUp />
          </button>
        </form>
        <section className="tries">
          <h2 className="label">Or start with one of these</h2>
          <ul>
            {brand.suggestions.map((text) => (
              <li key={text}>
                <button disabled={busy} onClick={() => void ask(text)}>
                  {text}
                </button>
              </li>
            ))}
          </ul>
        </section>
        {desk.briefs.length ? (
          <section className="briefs">
            <h2 className="label">Briefs</h2>
            <ul>
              {desk.briefs.map((brief) => (
                <li key={brief.id}>
                  <Link href={`/b/${brief.id}`}>
                    <b>{brief.title || brief.question}</b>
                    {brief.title ? <span>{brief.question}</span> : null}
                  </Link>
                  <i data-state={brief.state}>{brief.state === "done" && brief.sources ? count(brief.sources, "source") : STATE[brief.state]}</i>
                  <time>{ago(Date.parse(brief.createdAt))}</time>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </main>
  );
}
