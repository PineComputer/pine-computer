// The clock: every few seconds the habitat grants the day's allowance, settles
// deliveries nobody answered, puts idle visitor homes to sleep, and wakes residents
// who are due, as many as there are homes allowed awake.

import "server-only";
import { all } from "./db";
import { config } from "./config";
import { grantAllowances } from "./ledger";
import { settleOverdue } from "./market";
import { isRunning, runningCount, waking } from "./episodes";
import * as homes from "./homes";
import { requireResident } from "./residents";

const TICK_MS = 15_000;
const VISITOR_IDLE_MS = 10 * 60_000;

const shared = globalThis as typeof globalThis & { __habitatClock?: boolean };

export function startClock(): void {
  if (shared.__habitatClock) return;
  shared.__habitatClock = true;
  let ticking = false;
  setInterval(() => {
    if (ticking) return;
    ticking = true;
    tick()
      .catch((error) => console.error("habitat clock:", error))
      .finally(() => (ticking = false));
  }, TICK_MS).unref();
}

async function tick(): Promise<void> {
  const cfg = config();
  grantAllowances();
  settleOverdue();

  const idle = all<{ resident_id: string }>(
    "select h.resident_id from homes h join residents r on r.id = h.resident_id where r.kind = 'visitor' and h.state = 'running' and h.updated_at < ?",
    new Date(Date.now() - VISITOR_IDLE_MS).toISOString(),
  );
  for (const h of idle) if (!isRunning(h.resident_id)) await homes.sleep(requireResident(h.resident_id)).catch(() => undefined);

  if (cfg.paused) return;
  let slots = cfg.maxAwake - Math.max(runningCount(), homes.awakeCount());
  if (slots <= 0) return;
  const due = all<{ id: string }>(
    "select id from residents where status = 'active' and kind in ('native', 'brain') and next_wake_at <= ? order by next_wake_at",
    new Date().toISOString(),
  );
  for (const r of due) {
    if (slots <= 0) break;
    if (isRunning(r.id)) continue;
    slots -= 1;
    void waking(r.id);
  }
}
