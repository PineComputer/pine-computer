"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";

// The viewer draws onto a canvas in the browser; it never renders on the server.
const PineDesktop = dynamic(() => import("@pinesandbox/computer-web/react").then((m) => m.PineDesktop), { ssr: false });

/** A desktop connection from this app's server: the Computer's address and a two-minute token. */
async function delegation(thread: string) {
  const response = await fetch(`/api/threads/${encodeURIComponent(thread)}/desktop`, { method: "POST" });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Couldn't connect to the desktop.");
  // Loaded in the browser only: the package defines browser elements.
  const { connectionFromDelegation } = await import("@pinesandbox/computer-web");
  return connectionFromDelegation(body);
}

// The viewer takes the keyboard each time it connects, which the element doesn't let a
// page turn off. Watching needs no keyboard: the field that had it gets it back. The
// field is noted from the first focus on the page, before any desktop connects.
let typingIn: HTMLElement | null = null;
if (typeof document !== "undefined") {
  document.addEventListener("focusin", (event) => {
    const target = event.target as HTMLElement;
    if (!target.closest?.("pine-desktop")) typingIn = target;
  });
}

/**
 * The thread's live screen on its coworker's Computer. Watching sends no input; driving
 * is for a person who took control, which makes the coworker wait until they hand back.
 */
export function Desktop({ thread, stream, driving, onProblem }: { thread: string; stream: string; driving: boolean; onProblem: (text: string | null) => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const first = useRef<string | null>(null);
  const giveBackKeyboard = useCallback(() => {
    if (driving || !document.activeElement?.closest("pine-desktop")) return;
    if (typingIn?.isConnected) typingIn.focus();
    else (document.activeElement as HTMLElement).blur();
  }, [driving]);

  useEffect(() => {
    let current = true;
    setUrl(null);
    delegation(thread)
      .then((connection) => {
        if (!current) return;
        first.current = connection.token;
        setUrl(connection.url);
        onProblem(null);
      })
      .catch((error: Error) => current && onProblem(error.message));
    return () => {
      current = false;
    };
  }, [thread, stream, onProblem]);

  // Every connect, including an automatic reconnect, asks the server for a fresh token.
  const token = useCallback(async () => {
    const saved = first.current;
    first.current = null;
    return saved ?? (await delegation(thread)).token;
  }, [thread]);

  if (!url) return null;
  return (
    <PineDesktop
      className="desktop"
      url={url}
      token={token}
      control={driving ? "drive" : "view"}
      clipboard={driving ? ["local-to-remote", "remote-to-local"] : []}
      onConnected={() => {
        onProblem(null);
        giveBackKeyboard();
      }}
      onError={({ error }) => onProblem(error instanceof Error ? error.message : "The desktop connection failed.")}
    />
  );
}
