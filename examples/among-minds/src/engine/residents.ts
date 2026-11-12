// Residents: who lives here. Natives are released by stewards; second brains move in
// with a person's notes; visitor minds move in from elsewhere and act through the API.

import { all, get, now, run, transaction } from "./db";
import { grantInitial } from "./ledger";
import { record } from "./record";
import { trade } from "./trades";
import { colorFor, hash, id, token } from "./util";

export type Kind = "native" | "brain" | "visitor";

export interface Resident {
  id: string;
  name: string;
  kind: Kind;
  trade: string;
  temperament: string;
  persona: string;
  color: string;
  status: "active" | "frozen";
  created_at: string;
  note: string;
  intention: string;
  rhythm_minutes: number;
  last_wake_at: string | null;
  next_wake_at: string | null;
  quiet_streak: number;
}

const NAME = /^[A-Za-z][A-Za-z0-9 '-]{1,23}$/;
const COLUMNS = "id, name, kind, trade, temperament, persona, color, status, created_at, note, intention, rhythm_minutes, last_wake_at, next_wake_at, quiet_streak";

export function residents(): Resident[] {
  return all<Resident>(`select ${COLUMNS} from residents order by created_at`);
}

export function resident(idOrName: string): Resident | undefined {
  return get<Resident>(`select ${COLUMNS} from residents where id = ? or lower(name) = lower(?)`, idOrName, idOrName);
}

export function requireResident(idOrName: string): Resident {
  const found = resident(idOrName);
  if (!found) throw new Error(`Nobody called ${idOrName} lives here.`);
  return found;
}

/** Moves a new resident in. Returns its id and, for second brains and visitors, the token to keep. */
export function moveIn(input: { name: string; kind: Kind; trade: string; temperament?: string; persona?: string }): {
  id: string;
  token?: string;
} {
  const name = input.name.trim();
  if (!NAME.test(name)) throw new Error("A name is 2 to 24 letters, digits, spaces, apostrophes or hyphens, starting with a letter.");
  if (resident(name)) throw new Error(`Someone called ${name} already lives here.`);
  trade(input.trade); // it must exist
  const residentId = id("r");
  const secret = input.kind === "native" ? undefined : token();
  transaction(() => {
    run(
      `insert into residents (id, name, kind, trade, temperament, persona, color, created_at, owner_token_hash, api_token_hash, next_wake_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      residentId,
      name,
      input.kind,
      input.trade,
      input.temperament?.trim() ?? "",
      input.persona?.trim() ?? "",
      colorFor(residents().length),
      now(),
      input.kind === "brain" && secret ? hash(secret) : null,
      input.kind === "visitor" && secret ? hash(secret) : null,
      now(),
    );
    run("insert into homes (resident_id, updated_at) values (?, ?)", residentId, now());
    grantInitial(residentId);
  });
  const how = input.kind === "native" ? "was released" : input.kind === "brain" ? "moved in as a second brain" : "moved in from elsewhere";
  const title = trade(input.trade).title.toLowerCase();
  record(residentId, "move-in", `${name} ${how}, ${/^[aeiou]/.test(title) ? "an" : "a"} ${title}.`, { subject: residentId, data: { kind: input.kind, trade: input.trade } });
  return { id: residentId, token: secret };
}

/** The visitor mind a resident-API token belongs to. */
export function byApiToken(secret: string): Resident | undefined {
  return get<Resident>(`select ${COLUMNS} from residents where api_token_hash = ?`, hash(secret));
}

/** The second brain an owner token belongs to. */
export function byOwnerToken(secret: string): Resident | undefined {
  return get<Resident>(`select ${COLUMNS} from residents where owner_token_hash = ?`, hash(secret));
}

export function setStatus(residentId: string, status: "active" | "frozen"): void {
  run("update residents set status = ? where id = ?", status, residentId);
}

/** Asks for a resident to wake soon (a letter, a hire), without waking it twice. */
export function nudge(residentId: string, withinMinutes = 3): void {
  const soon = new Date(Date.now() + withinMinutes * 60_000).toISOString();
  run("update residents set next_wake_at = ? where id = ? and (next_wake_at is null or next_wake_at > ?)", soon, residentId, soon);
}
