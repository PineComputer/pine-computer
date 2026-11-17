"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { enc } from "../common/api";

// The viewer draws onto a canvas in the browser; it never renders on the server.
const PineDesktop = dynamic(() => import("@pinesandbox/computer-web/react").then((m) => m.PineDesktop), { ssr: false });

/** A desktop connection from this app's server: the Computer's address and a two-minute token. */
async function delegation(run: string) {
  const response = await fetch(`/api/runs/${enc(run)}/desktop`, { method: "POST" });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Couldn't connect to the desktop.");
  // Loaded in the browser only: the package defines browser elements.
  const { connectionFromDelegation } = await import("@pinesandbox/computer-web");
  return connectionFromDelegation(body);
}

/**
 * A reader's live screen. Watching sends no input; driving is for a person who took
 * the controls, which makes the reader wait until they hand back. `live` names the
 * run's session and its sandbox: a new one opens a new connection.
 */
export function Desktop({ run, live, driving, onConnected }: { run: string; live: string; driving: boolean; onConnected?: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const first = useRef<string | null>(null);

  useEffect(() => {
    let current = true;
    setUrl(null);
    delegation(run)
      .then((connection) => {
        if (!current) return;
        first.current = connection.token;
        setUrl(connection.url);
      })
      .catch(() => undefined); // the last screen stays in its place
    return () => {
      current = false;
    };
  }, [run, live]);

  // Every connect, including an automatic reconnect, asks the server for a fresh token.
  const token = useCallback(async () => {
    const saved = first.current;
    first.current = null;
    return saved ?? (await delegation(run)).token;
  }, [run]);

  if (!url) return null;
  return (
    <PineDesktop
      className="desktop"
      url={url}
      token={token}
      // `control` flips in place. The clipboard stays off: changing its directions would
      // reconnect the screen at the very moment a person takes over.
      control={driving ? "drive" : "view"}
      onConnected={() => {
        // The viewer takes the keyboard when it connects. Watching needs none.
        if (!driving && document.activeElement?.closest("pine-desktop")) (document.activeElement as HTMLElement).blur();
        onConnected?.();
      }}
    />
  );
}
