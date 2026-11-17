"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";

// The viewer draws onto a canvas in the browser; it never renders on the server.
const PineDesktop = dynamic(() => import("@pinesandbox/computer-web/react").then((m) => m.PineDesktop), { ssr: false });

/** A desktop connection from this app's server: the Computer's address and a two-minute token. */
async function delegation(run: string) {
  const response = await fetch(`/api/runs/${encodeURIComponent(run)}/desktop`, { method: "POST" });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Couldn't connect to the screen.");
  // Loaded in the browser only: the package defines browser elements.
  const { connectionFromDelegation } = await import("@pinesandbox/computer-web");
  return connectionFromDelegation(body);
}

/**
 * The run's live screen on the Computer. Watching sends no input; driving is for a
 * person who took the controls, which makes the agent wait until they hand back.
 */
export function Desktop({ run, stream, driving, onProblem, onConnected }: { run: string; stream: string; driving: boolean; onProblem: (text: string | null) => void; onConnected?: () => void }) {
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
        onProblem(null);
      })
      .catch((error: Error) => current && onProblem(error.message));
    return () => {
      current = false;
    };
  }, [run, stream, onProblem]);

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
      control={driving ? "drive" : "view"}
      clipboard={driving ? ["local-to-remote", "remote-to-local"] : []}
      onConnected={() => {
        onProblem(null);
        // Watching needs no keyboard: the viewer takes it on every connect.
        if (!driving && document.activeElement?.closest("pine-desktop")) (document.activeElement as HTMLElement).blur();
        onConnected?.();
      }}
      onError={({ error }) => onProblem(error instanceof Error ? error.message : "The screen's connection failed.")}
    />
  );
}
