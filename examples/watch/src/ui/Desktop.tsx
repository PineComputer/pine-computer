"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";

// The viewer draws onto a canvas in the browser; it never renders on the server.
const PineDesktop = dynamic(() => import("@pinesandbox/computer-web/react").then((m) => m.PineDesktop), { ssr: false });

/** A desktop connection from this app's server: the Computer's address and a two-minute token. */
async function delegation() {
  const response = await fetch("/api/desktop", { method: "POST" });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Couldn't connect to the desktop.");
  // Loaded in the browser only: the package defines browser elements.
  const { connectionFromDelegation } = await import("@pinesandbox/computer-web");
  return connectionFromDelegation(body);
}

/**
 * The Computer's live screen during a check. Watching sends no input; driving is for a
 * person who took the controls, which makes the agent wait until they hand back.
 */
export function Desktop({ driving, shown }: { driving: boolean; shown: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  // Hidden until it is connected and has something to show, so the last screen shows through.
  const [connected, setConnected] = useState(false);
  const first = useRef<string | null>(null);

  useEffect(() => {
    let current = true;
    let retry: ReturnType<typeof setTimeout>;
    // The session opens a moment after the Computer starts: ask until it is there.
    const connect = () =>
      delegation()
        .then((connection) => {
          if (!current) return;
          first.current = connection.token;
          setUrl(connection.url);
        })
        .catch(() => current && (retry = setTimeout(connect, 1_500)));
    void connect();
    return () => {
      current = false;
      clearTimeout(retry);
    };
  }, []);

  // Every connect, including an automatic reconnect, asks the server for a fresh token.
  const token = useCallback(async () => {
    const saved = first.current;
    first.current = null;
    return saved ?? (await delegation()).token;
  }, []);

  if (!url) return null;
  return (
    <div className="live" data-connected={connected && shown}>
      <PineDesktop
        className="desktop"
        url={url}
        token={token}
        control={driving ? "drive" : "view"}
        clipboard={driving ? ["local-to-remote", "remote-to-local"] : []}
        onConnected={() => {
          setConnected(true);
          // The viewer takes the keyboard when it connects; watching needs none.
          if (!driving) (document.activeElement as HTMLElement | null)?.blur();
        }}
      />
    </div>
  );
}
