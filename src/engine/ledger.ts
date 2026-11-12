// Energy: the habitat's only currency, in dollars of real spend. Work is admitted only
// if its worst case fits: for a resident and for the world, settled spend plus open
// reservations never exceeds what is allowed.

import { all, get, now, run, setting, setSetting, transaction } from "./db";
import { config } from "./config";
import { record } from "./record";
import { id, money, round } from "./util";

export function balance(residentId: string): number {
  return round(get<{ total: number | null }>("select sum(amount) as total from ledger where resident_id = ?", residentId)?.total ?? 0);
}

export function reserved(residentId: string): number {
  return round(get<{ total: number | null }>("select sum(amount) as total from reservations where resident_id = ?", residentId)?.total ?? 0);
}

export function available(residentId: string): number {
  return round(balance(residentId) - reserved(residentId));
}

const dayStart = () => new Date().toISOString().slice(0, 10);

/** What the whole habitat has spent today, plus what it has reserved. */
export function worldCommitted(): { spent: number; reserved: number } {
  const spent = -(get<{ total: number | null }>("select sum(amount) as total from ledger where kind = 'spend' and at >= ?", dayStart())?.total ?? 0);
  const held = get<{ total: number | null }>("select sum(amount) as total from reservations")?.total ?? 0;
  return { spent: round(spent), reserved: round(held) };
}

/** Holds the worst case of some work before it starts. Returns the reservation, or why not. */
export function reserve(residentId: string, amount: number, ref: string): { id: string } | { refused: string } {
  return transaction(() => {
    if (available(residentId) < amount) return { refused: `needs ${money(amount)} of energy, has ${money(available(residentId))}` };
    const world = worldCommitted();
    if (world.spent + world.reserved + amount > config().dayBudget) return { refused: "the habitat's budget for today is spent" };
    const reservation = id("rsv");
    run("insert into reservations (id, resident_id, amount, ref, created_at) values (?, ?, ?, ?, ?)", reservation, residentId, amount, ref, now());
    return { id: reservation };
  });
}

/** Replaces a reservation with what the work actually cost. */
export function settle(reservationId: string, cost: number, memo: string): void {
  transaction(() => {
    const held = get<{ resident_id: string; ref: string }>("select resident_id, ref from reservations where id = ?", reservationId);
    if (!held) return;
    run("delete from reservations where id = ?", reservationId);
    if (cost > 0) run("insert into ledger (at, resident_id, amount, kind, ref, memo) values (?, ?, ?, 'spend', ?, ?)", now(), held.resident_id, -round(cost), held.ref, memo);
  });
}

/** Moves energy between residents (escrow, payments, refunds, skill sales). Never creates it. */
export function transfer(from: string | null, to: string | null, amount: number, kind: string, ref: string, memo: string): void {
  if (from) run("insert into ledger (at, resident_id, amount, kind, ref, memo) values (?, ?, ?, ?, ?, ?)", now(), from, -round(amount), kind, ref, memo);
  if (to) run("insert into ledger (at, resident_id, amount, kind, ref, memo) values (?, ?, ?, ?, ?, ?)", now(), to, round(amount), kind, ref, memo);
}

/** Once a world day, every active resident receives the same allowance. */
export function grantAllowances(): void {
  const day = dayStart();
  if (setting("allowance-day") === day) return;
  const { allowance } = config();
  transaction(() => {
    // Those who moved in today already received their first allowance.
    const residents = all<{ id: string }>("select id from residents where status = 'active' and created_at < ?", day);
    for (const r of residents) transfer(null, r.id, allowance, "allowance", day, `allowance for ${day}`);
    setSetting("allowance-day", day);
  });
  record("habitat", "allowance", `A new day: every resident received ${money(allowance)}.`, { data: { day, allowance } });
}

export function grantInitial(residentId: string): void {
  transfer(null, residentId, config().allowance, "allowance", "move-in", "first allowance");
}

export interface LedgerRow {
  id: number;
  at: string;
  amount: number;
  kind: string;
  ref: string | null;
  memo: string;
}

export function history(residentId: string, limit = 50): LedgerRow[] {
  return all<LedgerRow>("select id, at, amount, kind, ref, memo from ledger where resident_id = ? order by id desc limit ?", residentId, limit);
}
