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
  const { connectionFromDelegation } = await import("@pinesandbox/computer-web");
  return connectionFromDelegation(body);
}

/** The claims session's live screen. Watching sends no input; driving is for a person who took the controls. */
export function Desktop({ generation, driving, onProblem }: { generation: string; driving: boolean; onProblem: (text: string | null) => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const first = useRef<string | null>(null);

  useEffect(() => {
    let current = true;
    setUrl(null);
    delegation()
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
  }, [generation, onProblem]);

  // Every connect, including an automatic reconnect, asks the server for a fresh token.
  const token = useCallback(async () => {
    const saved = first.current;
    first.current = null;
    return saved ?? (await delegation()).token;
  }, []);

  if (!url) return null;
  return (
    <PineDesktop
      className="desktop"
      url={url}
      token={token}
      control={driving ? "drive" : "view"}
      clipboard={driving ? ["local-to-remote", "remote-to-local"] : []}
      onConnected={() => onProblem(null)}
      onError={({ error }) => onProblem(error instanceof Error ? error.message : "The desktop connection failed.")}
    />
  );
}
