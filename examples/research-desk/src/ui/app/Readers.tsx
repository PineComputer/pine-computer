"use client";

// The desk's three readers and their Computers, behind one button in the bar. A
// Computer is created the first time its reader is needed, reused for the next brief,
// and stops itself when it has sat idle; it can be stopped here too.

import { useEffect, useRef, useState } from "react";
import type { ReaderView } from "@/shared/api";
import { call, enc } from "../common/api";
import { clock } from "../common/format";
import { useDesk } from "./Desk";

const WORDS: Record<ReaderView["computer"], string> = { none: "No computer yet", stopped: "Computer stopped", starting: "Computer starting", running: "Computer running", stopping: "Computer stopping" };

export function Readers() {
  const { desk, act } = useDesk();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const running = desk.readers.filter((r) => r.computer === "running" || r.computer === "starting").length;

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => !box.current?.contains(event.target as Node) && setOpen(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div className="readers" ref={box}>
      <button className="btn ghost sm" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="lamps" aria-hidden>
          {desk.readers.map((r) => (
            <i key={r.id} data-on={r.computer === "running" ? (r.busy ? "busy" : "on") : r.computer === "starting" ? "starting" : undefined} />
          ))}
        </span>
        {running ? `${running} of ${desk.readers.length} computers running` : "Computers stopped"}
      </button>
      {open ? (
        <div className="menu" role="dialog" aria-label="Readers">
          <ul>
            {desk.readers.map((reader) => (
              <li key={reader.id}>
                <b>{reader.name}</b>
                <span>
                  {reader.busy ? "At work" : WORDS[reader.computer]}
                  {reader.computer === "running" && !reader.busy && reader.expiresAt ? ` · stops itself at ${clock(Date.parse(reader.expiresAt))}` : ""}
                </span>
                {reader.computer === "running" ? (
                  <button
                    className="btn sm"
                    aria-busy={busy === reader.id}
                    disabled={busy !== null || reader.busy}
                    onClick={async () => {
                      setBusy(reader.id);
                      await act(() => call(`/api/readers/${enc(reader.id)}`, { body: { action: "stop" } }));
                      setBusy(null);
                    }}
                  >
                    Stop
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          <p>Each reader has a Pine Computer of its own. It is created when first needed, kept for the next brief, and stops itself when idle.</p>
        </div>
      ) : null}
    </div>
  );
}
