"use client";

import { KeyRound, Plus } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { brand } from "@/brand";
import type { ThreadView } from "@/shared/api";
import { Avatar } from "../common/kit";
import { Hire } from "./Hire";
import { ThemeToggle } from "./Theme";
import { Vault } from "./Vault";
import { useWorkspace } from "./Workspace";

/** A roster: three seats side by side, one of them at work. Replace with your own. */
export function Logo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size * 1.5} height={size} viewBox="0 0 33 22" aria-hidden="true">
      <circle cx="8" cy="11" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="16" cy="11" r="6.2" fill="var(--bg-side)" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="24.5" cy="11" r="7" fill="var(--accent)" stroke="var(--bg-side)" strokeWidth="1.6" />
    </svg>
  );
}

/** How many of a coworker's threads the sidebar lists before "N more". */
const SHOWN = 4;

/** The coworkers, each with its latest threads under it. */
export function Sidebar() {
  const { ws } = useWorkspace();
  const path = usePathname();
  const [dialog, setDialog] = useState<"hire" | "vault" | null>(null);
  const [all, setAll] = useState<Set<string>>(new Set());
  return (
    <nav className="side" aria-label="Coworkers and threads">
      <div className="side-top">
        <Link href="/" className="logo">
          <Logo /> {brand.name}
        </Link>
      </div>
      <div className="side-scroll">
        <span className="label">Team</span>
        {ws.coworkers.map((coworker) => {
          // Newest first; one that needs you, or is open, is never folded away.
          const threads = ws.threads.filter((t) => t.coworker === coworker.id).reverse();
          const open = all.has(coworker.id);
          const kept = (thread: ThreadView, i: number) => open || i < SHOWN || thread.status !== "idle" || path === `/t/${thread.id}`;
          const shown = threads.filter(kept);
          const more = threads.length - shown.length;
          return (
            <div key={coworker.id}>
              <Link href={`/c/${coworker.id}`} className="side-row" aria-current={path === `/c/${coworker.id}` ? "page" : undefined}>
                <Avatar name={coworker.name} color={coworker.color} status={coworker.status} />
                <span className="name">{coworker.name}</span>
                <span className="role">{coworker.role}</span>
              </Link>
              {threads.length ? (
                <div className="side-threads">
                  {shown.map((thread) => (
                    <Link key={thread.id} href={`/t/${thread.id}`} className="side-thread" aria-current={path === `/t/${thread.id}` ? "page" : undefined}>
                      <span>{thread.title}</span>
                      {thread.status !== "idle" ? <i className="dot" data-status={thread.status} /> : null}
                    </Link>
                  ))}
                  {more > 0 || (open && threads.length > SHOWN) ? (
                    <button
                      className="side-thread more"
                      onClick={() =>
                        setAll((now) => {
                          const next = new Set(now);
                          if (!next.delete(coworker.id)) next.add(coworker.id);
                          return next;
                        })
                      }
                    >
                      <span>{open ? "Show fewer" : `${more} more`}</span>
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
        <button className="btn ghost hire" onClick={() => setDialog("hire")}>
          <span className="plus">
            <Plus />
          </span>
          Hire a coworker
        </button>
      </div>
      <div className="side-foot">
        <button className="btn ghost sm" onClick={() => setDialog("vault")}>
          <KeyRound /> Vault
        </button>
        <span className="push">
          <ThemeToggle />
        </span>
      </div>
      {dialog === "hire" ? <Hire onClose={() => setDialog(null)} /> : null}
      {dialog === "vault" ? <Vault onClose={() => setDialog(null)} /> : null}
    </nav>
  );
}
