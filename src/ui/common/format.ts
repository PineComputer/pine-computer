export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m}m ${s % 60}s` : `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** Time into the turn, as a column of times reads: 0:42, 12:05. */
export function offset(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** A countdown: 4:05, or 1:02:09. */
export function countdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${rest}` : `${m}:${rest}`;
}

export function clock(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** "in 5 min", "3 h ago", or a date. */
export function relative(at: number, now = Date.now()): string {
  const diff = at - now;
  const abs = Math.abs(diff);
  const say = (n: number, unit: string) => (diff >= 0 ? `in ${n} ${unit}` : `${n} ${unit} ago`);
  // A moment either way is now: the page's clock trails the server's by a tick.
  if (abs < 60_000) return diff > 5_000 ? "in under a minute" : "just now";
  if (abs < 3_600_000) return say(Math.round(abs / 60_000), "min");
  if (abs < 86_400_000) return say(Math.round(abs / 3_600_000), "h");
  return new Date(at).toLocaleDateString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
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
    return url;
  }
}
