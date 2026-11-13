"use client";

import { KeyRound, Plus } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { brand } from "@/brand";
import { Avatar } from "../common/kit";
import { Hire } from "./Hire";
import { ThemeToggle } from "./Theme";
import { Vault } from "./Vault";
import { useWorkspace } from "./Workspace";

/** Three seats at one table. Replace with your own. */
export function Logo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="3" width="8" height="8" rx="2.5" fill="var(--accent)" />
      <rect x="13" y="3" width="8" height="8" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <rect x="3" y="13" width="8" height="8" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <rect x="13" y="13" width="8" height="8" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

/** The coworkers, each with its threads under it. */
export function Sidebar() {
  const { ws } = useWorkspace();
  const path = usePathname();
  const [dialog, setDialog] = useState<"hire" | "vault" | null>(null);
  return (
    <nav className="side" aria-label="Coworkers and threads">
      <div className="side-top">
        <Link href="/" className="logo">
          <Logo /> {brand.name}
        </Link>
      </div>
      <div className="side-scroll">
        <span className="label">Coworkers</span>
        {ws.coworkers.map((coworker) => {
          const threads = ws.threads.filter((t) => t.coworker === coworker.id);
          return (
            <div key={coworker.id}>
              <Link href={`/c/${coworker.id}`} className="side-row" aria-current={path === `/c/${coworker.id}` ? "page" : undefined}>
                <Avatar name={coworker.name} color={coworker.color} status={coworker.status} />
                <span className="name">{coworker.name}</span>
                <span className="role">{coworker.role}</span>
              </Link>
              {threads.length ? (
                <div className="side-threads">
                  {threads.map((thread) => (
                    <Link key={thread.id} href={`/t/${thread.id}`} className="side-thread" aria-current={path === `/t/${thread.id}` ? "page" : undefined}>
                      <span>{thread.title}</span>
                      {thread.status !== "idle" ? <i className="dot" data-status={thread.status} /> : null}
                    </Link>
                  ))}
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
