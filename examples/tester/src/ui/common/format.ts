/** Time into the run, as a column of times reads: 0:42, 12:05. */
export function offset(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function clock(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** "3 min ago", "2 h ago", or a date. */
export function ago(at: number, now = Date.now()): string {
  const passed = Math.max(0, now - at);
  if (passed < 60_000) return "just now";
  if (passed < 3_600_000) return `${Math.round(passed / 60_000)} min ago`;
  if (passed < 86_400_000) return `${Math.round(passed / 3_600_000)} h ago`;
  return new Date(at).toLocaleDateString([], { month: "short", day: "numeric" });
}
