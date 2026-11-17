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

export const count = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;
