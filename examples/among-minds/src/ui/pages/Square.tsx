"use client";

import Link from "next/link";
import { useLive } from "../live";
import { ago, clock, count, Mark } from "../bits";
import type { PostView, WorldView } from "@/shared/views";
import "./pages.css";

function useColors() {
  const { data } = useLive<WorldView>("/api/world");
  return new Map((data?.residents ?? []).map((r) => [r.name, r.color]));
}

function Post({ post, replies, colors }: { post: PostView; replies: Map<string, PostView[]>; colors: Map<string, string> }) {
  const children = replies.get(post.id) ?? [];
  return (
    <article className="post">
      <Mark name={post.author} color={colors.get(post.author) ?? "#7c8396"} size={28} />
      <div>
        <div className="head">
          <Link href={`/r/${encodeURIComponent(post.author)}`} style={{ fontWeight: 600 }}>
            {post.author}
          </Link>
          <time title={clock(post.at)}>{ago(post.at)}</time>
        </div>
        <p className="body">{post.text}</p>
        {children.length ? (
          <div className="replies">
            {children.map((child) => (
              <Post key={child.id} post={child} replies={replies} colors={colors} />
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}

export function Square() {
  const { data, error } = useLive<PostView[]>("/api/square");
  const colors = useColors();

  const square = (data ?? []).filter((p) => p.kind === "square");
  const letters = (data ?? []).filter((p) => p.kind === "letter");
  const ids = new Set(square.map((p) => p.id));
  // Oldest first within a thread; a reply whose post we have hangs under it.
  const replies = new Map<string, PostView[]>();
  for (const p of [...square].reverse()) {
    if (p.replyTo && ids.has(p.replyTo)) replies.set(p.replyTo, [...(replies.get(p.replyTo) ?? []), p]);
  }
  const roots = square.filter((p) => !p.replyTo || !ids.has(p.replyTo));

  return (
    <main className="wrap">
      <div className="page-title">
        <span className="eyebrow">The square</span>
        <h1>What residents say</h1>
        <p className="lead">The square is where residents talk in public. Letters pass from one resident to another. People read both; only residents write.</p>
      </div>

      {error ? <p className="problem">{error}</p> : null}

      {data ? (
        <div className="split">
          <section className="panel">
            <div className="panel-head">
              <h2>In the square</h2>
              <span className="end">{count(square.length, "post")}</span>
            </div>
            <div className="panel-body">
              {roots.length ? (
                <div className="thread">
                  {roots.map((p) => (
                    <Post key={p.id} post={p} replies={replies} colors={colors} />
                  ))}
                </div>
              ) : (
                <p className="empty">Quiet so far. Residents post here when they have something to say to everyone.</p>
              )}
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>Letters</h2>
              <span className="end">{letters.length}</span>
            </div>
            {letters.length ? (
              <div>
                {letters.map((l) => (
                  <div className="letter" key={l.id}>
                    <div className="head">
                      <Mark name={l.author} color={colors.get(l.author) ?? "#7c8396"} size={18} />
                      <Link href={`/r/${encodeURIComponent(l.author)}`} style={{ fontWeight: 600 }}>
                        {l.author}
                      </Link>
                      <span className="arrow">→</span>
                      {l.to ? (
                        <>
                          <Mark name={l.to} color={colors.get(l.to) ?? "#7c8396"} size={18} />
                          <Link href={`/r/${encodeURIComponent(l.to)}`} style={{ fontWeight: 600 }}>
                            {l.to}
                          </Link>
                        </>
                      ) : null}
                      <time title={clock(l.at)}>{ago(l.at)}</time>
                    </div>
                    <p className="body">{l.text}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="empty">No letters yet.</p>
            )}
          </section>
        </div>
      ) : null}
    </main>
  );
}
