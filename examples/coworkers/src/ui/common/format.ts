/** "42 s", "1 min 40 s", "2 h 5 min". */
export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m} min ${s % 60} s` : `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

/** Time into the job, as a column of times reads: 0:42, 12:05. */
export function offset(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function clock(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** "3 min ago", "2 h ago", or a date. */
export function ago(at: number, now = Date.now()): string {
  const passed = Math.max(0, now - at);
  if (passed < 60_000) return "just now";
  if (passed < 3_600_000) return `${Math.round(passed / 60_000)} min ago`;
  if (passed < 86_400_000) return `${Math.round(passed / 3_600_000)} h ago`;
  return new Date(at).toLocaleDateString([], { month: "short", day: "numeric" });
}

export function cost(usd: number | null | undefined): string | null {
  if (usd === null || usd === undefined) return null;
  return usd > 0 && usd < 0.005 ? "<$0.01" : `$${usd.toFixed(2)}`;
}

export function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function kindOf(path: string): string {
  return /\.([a-z0-9]{1,5})$/i.exec(path)?.[1]?.toUpperCase() ?? "FILE";
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
