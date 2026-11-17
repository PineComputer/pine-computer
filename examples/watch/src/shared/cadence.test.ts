import { describe, expect, it } from "vitest";
import { describeCadence, next, validCadence } from "./cadence";

// Local times: next() works in the server's time zone, as a person reads a schedule.
const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min);

describe("next", () => {
  it("adds the interval", () => {
    expect(next({ kind: "interval", minutes: 30 }, at(2026, 10, 16, 9, 10))).toEqual(at(2026, 10, 16, 9, 40));
  });

  it("runs later today when the time is still ahead", () => {
    expect(next({ kind: "daily", at: "09:00", weekdays: false }, at(2026, 10, 16, 8, 59))).toEqual(at(2026, 10, 16, 9, 0));
  });

  it("runs tomorrow once today's time has come", () => {
    expect(next({ kind: "daily", at: "09:00", weekdays: false }, at(2026, 10, 16, 9, 0))).toEqual(at(2026, 10, 17, 9, 0));
  });

  it("skips the weekend on weekdays", () => {
    // Friday 16 October 2026, after nine: the next weekday is Monday the 19th.
    expect(next({ kind: "daily", at: "09:00", weekdays: true }, at(2026, 10, 16, 10, 0))).toEqual(at(2026, 10, 19, 9, 0));
  });
});

describe("validCadence", () => {
  it("refuses intervals under 15 minutes and malformed times", () => {
    expect(validCadence({ kind: "interval", minutes: 5 })).toBe(false);
    expect(validCadence({ kind: "interval", minutes: 15 })).toBe(true);
    expect(validCadence({ kind: "daily", at: "9:00", weekdays: false })).toBe(false);
    expect(validCadence({ kind: "daily", at: "24:00", weekdays: false })).toBe(false);
    expect(validCadence({ kind: "daily", at: "23:59", weekdays: true })).toBe(true);
  });
});

describe("describeCadence", () => {
  it("says it as a person would", () => {
    expect(describeCadence({ kind: "interval", minutes: 60 })).toBe("Every hour");
    expect(describeCadence({ kind: "interval", minutes: 90 })).toBe("Every 90 minutes");
    expect(describeCadence({ kind: "daily", at: "08:30", weekdays: true })).toBe("Weekdays at 08:30");
  });
});
