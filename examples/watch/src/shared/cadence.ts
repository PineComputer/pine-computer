// When a watch is checked next, and how to say it. Pure, so the server and the page agree.

import type { Cadence } from "./api";

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function validCadence(cadence: Cadence): boolean {
  if (cadence.kind === "interval") return Number.isInteger(cadence.minutes) && cadence.minutes >= 15 && cadence.minutes <= 7 * 24 * 60;
  return cadence.kind === "daily" && TIME.test(cadence.at) && typeof cadence.weekdays === "boolean";
}

/** The first time after `from` that `cadence` comes round, on the minute, in the server's time zone. */
export function next(cadence: Cadence, from: Date): Date {
  if (cadence.kind === "interval") return new Date(Math.floor(from.getTime() / 60_000) * 60_000 + cadence.minutes * 60_000);
  const [hours, minutes] = cadence.at.split(":").map(Number);
  const at = new Date(from);
  at.setHours(hours, minutes, 0, 0);
  while (at <= from || (cadence.weekdays && (at.getDay() === 0 || at.getDay() === 6))) at.setDate(at.getDate() + 1);
  return at;
}

/**
 * The slot after `slot` that is still ahead of `now`. Counting from the slot, not from
 * when its check ran, keeps an interval on its grid: 14:30, 14:45, 15:00.
 */
export function after(cadence: Cadence, slot: Date, now: Date): Date {
  let at = next(cadence, slot);
  while (at <= now) at = next(cadence, at);
  return at;
}

export function describeCadence(cadence: Cadence): string {
  if (cadence.kind === "interval") {
    const { minutes } = cadence;
    if (minutes % 1440 === 0) return minutes === 1440 ? "Every day" : `Every ${minutes / 1440} days`;
    if (minutes % 60 === 0) return minutes === 60 ? "Every hour" : `Every ${minutes / 60} hours`;
    return `Every ${minutes} minutes`;
  }
  return `${cadence.weekdays ? "Weekdays" : "Every day"} at ${cadence.at}`;
}
