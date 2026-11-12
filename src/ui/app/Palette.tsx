"use client";

import {
  Clock3,
  FolderOpen,
  Globe,
  KeyRound,
  MessageSquarePlus,
  Monitor,
  Pause,
  Play,
  Plus,
  Power,
  Sparkles,
  SquareTerminal,
  type LucideIcon,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { call, errorText } from "../common/api";
import { useApp } from "./AppProvider";

interface Command {
  group: string;
  label: string;
  icon: LucideIcon;
  hint?: string;
  run: () => void | Promise<void>;
}

/** Tells the open session view to do something: the palette and the view stay apart. */
export function sessionCommand(name: "terminal" | "composer" | "new-conversation" | "open-url") {
  window.dispatchEvent(new CustomEvent("session-command", { detail: name }));
}

/** ⌘K: every place and action, typed. */
export function Palette() {
  const { palette, setPalette, app, lifecycle, refresh, toast } = useApp();
  const router = useRouter();
  const path = usePathname();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const state = app?.computer?.state;
  const inSession = path.startsWith("/s/");

  const commands = useMemo(() => {
    const go = (href: string) => () => router.push(href);
    const list: Command[] = [];
    for (const s of app?.sessions ?? []) list.push({ group: "Sessions", label: s.label, icon: Monitor, hint: s.working ? "working" : undefined, run: go(`/s/${s.name}`) });
    if (state === "running") {
      list.push({
        group: "Sessions",
        label: "New session",
        icon: Plus,
        run: async () => {
          try {
            const { name } = await call<{ name: string }>("/api/sessions", { body: { label: `Session ${(app?.sessions.length ?? 0) + 1}` } });
            await refresh();
            router.push(`/s/${name}`);
          } catch (error) {
            toast({ tone: "failed", text: errorText(error) });
          }
        },
      });
    }
    if (inSession && state === "running") {
      list.push(
        { group: "This session", label: "Give it a task", icon: MessageSquarePlus, hint: "Focus the composer", run: () => sessionCommand("composer") },
        { group: "This session", label: "Open a page", icon: Globe, run: () => sessionCommand("open-url") },
        { group: "This session", label: "Toggle the terminal", icon: SquareTerminal, run: () => sessionCommand("terminal") },
        { group: "This session", label: "New conversation", icon: MessageSquarePlus, run: () => sessionCommand("new-conversation") },
      );
    }
    list.push(
      { group: "Go to", label: "Skills", icon: Sparkles, run: go("/skills") },
      { group: "Go to", label: "Schedules", icon: Clock3, run: go("/schedules") },
      { group: "Go to", label: "Files", icon: FolderOpen, run: go("/files") },
      { group: "Go to", label: "Vault", icon: KeyRound, run: go("/vault") },
      { group: "Go to", label: "Computer", icon: Monitor, run: go("/computer") },
    );
    if (state === "running") {
      if (app?.computer?.canPause) list.push({ group: "Computer", label: "Pause the Computer", icon: Pause, run: () => void lifecycle("pause") });
      list.push({ group: "Computer", label: "Stop the Computer", icon: Power, run: () => void lifecycle("stop") });
    } else if (state === "paused") {
      list.push({ group: "Computer", label: "Resume the Computer", icon: Play, run: () => void lifecycle("resume") });
    } else if (state === "stopped") {
      list.push({ group: "Computer", label: "Start the Computer", icon: Play, run: () => void lifecycle("start") });
    }
    return list;
  }, [app, state, inSession, router, lifecycle, refresh, toast]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? commands.filter((c) => `${c.group} ${c.label}`.toLowerCase().includes(q)) : commands;
  }, [commands, query]);

  useEffect(() => {
    setIndex(0);
  }, [query, palette]);
  useEffect(() => {
    if (!palette) setQuery("");
  }, [palette]);

  if (!palette) return null;
  const choose = (command: Command | undefined) => {
    if (!command) return;
    setPalette(false);
    void command.run();
  };

  let lastGroup = "";
  return createPortal(
    <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && setPalette(false)}>
      <div className="palette" role="dialog" aria-label="Command palette">
        <input
          autoFocus
          placeholder="Jump to a session, a page, or an action…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") (event.preventDefault(), setIndex((i) => Math.min(shown.length - 1, i + 1)));
            else if (event.key === "ArrowUp") (event.preventDefault(), setIndex((i) => Math.max(0, i - 1)));
            else if (event.key === "Enter") choose(shown[index]);
            else if (event.key === "Escape") setPalette(false);
          }}
        />
        <ul role="listbox">
          {shown.length === 0 ? <li className="empty-note">Nothing matches.</li> : null}
          {shown.flatMap((command, i) => {
            const Icon = command.icon;
            const items = [];
            if (command.group !== lastGroup) items.push(<li key={`g:${command.group}`} role="presentation" className="group">{command.group}</li>);
            lastGroup = command.group;
            items.push(
              <li key={`${command.group}:${command.label}`} role="option" aria-selected={i === index} onMouseEnter={() => setIndex(i)} onClick={() => choose(command)}>
                <Icon />
                {command.label}
                {command.hint ? <span className="hint">{command.hint}</span> : null}
              </li>,
            );
            return items;
          })}
        </ul>
      </div>
    </div>,
    document.body,
  );
}
