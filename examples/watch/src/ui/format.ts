/** A time of day as a schedule reads: 14:30. With seconds where two times are compared. */
export function clock(at: string | number, seconds = false): string {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", ...(seconds ? { second: "2-digit" } : {}), hour12: false });
}

/** 14:30 today, or "Mon 14:30" on another day. */
export function when(at: string | number, now = Date.now()): string {
  const date = new Date(at);
  if (date.toDateString() === new Date(now).toDateString()) return clock(at);
  return `${date.toLocaleDateString([], { weekday: "short" })} ${clock(at)}`;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
