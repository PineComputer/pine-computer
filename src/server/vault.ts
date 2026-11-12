// The user's vault: sign-ins and keys the agent uses without seeing them.
//
// Each run, answer and steer carries the vault as `secrets`. The Computer writes them
// to a file only the session can read; the agent refers to one as $NAME in the command
// that needs it, so the shell fills the value in and the model never reads it. Values
// are registered for redaction too: one printed by mistake is removed from events and
// results. They last while the Computer runs, so every call sends them again.

import "server-only";
import type { SecretView } from "@/shared/api";
import { HttpError } from "./http";
import { open, readUser, seal, updateUser } from "./store";

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MAX_SECRETS = 64;
const MAX_BYTES = 32 * 1024;

export async function listSecrets(user: string): Promise<SecretView[]> {
  return (await readUser(user)).secrets.map(({ name, note, updatedAt }) => ({ name, note, updatedAt }));
}

export async function setSecret(user: string, input: { name?: string; value?: string; note?: string }): Promise<void> {
  const name = input.name?.trim() ?? "";
  const value = input.value ?? "";
  if (!NAME.test(name)) throw new HttpError(400, "Name it with letters, digits and _, not starting with a digit.");
  if (/^(PINE_|AGENT_BROWSER_)/i.test(name)) throw new HttpError(400, "Names starting with PINE_ or AGENT_BROWSER_ are reserved.");
  if (!value || /[\r\n]/.test(value)) throw new HttpError(400, "A value is one line. Encode longer material, a PEM key say, as base64.");
  const others = (await secretValues(user)) ?? {};
  delete others[name];
  if (Object.keys(others).length >= MAX_SECRETS) throw new HttpError(400, `The vault holds up to ${MAX_SECRETS} secrets.`);
  const bytes = Object.entries({ ...others, [name]: value }).reduce((n, [k, v]) => n + Buffer.byteLength(k) + Buffer.byteLength(v), 0);
  if (bytes > MAX_BYTES) throw new HttpError(400, "The vault holds up to 32 KiB in all.");
  await updateUser(user, (data) => {
    data.secrets = data.secrets.filter((s) => s.name !== name);
    data.secrets.push({ name, value: seal(value), note: input.note?.trim() || undefined, updatedAt: new Date().toISOString() });
    data.secrets.sort((a, b) => a.name.localeCompare(b.name));
  });
}

export async function deleteSecret(user: string, name: string): Promise<void> {
  await updateUser(user, (data) => {
    data.secrets = data.secrets.filter((s) => s.name !== name);
  });
}

/** The vault's values, for the call that hands them to the Computer; undefined when it's empty. */
export async function secretValues(user: string): Promise<Record<string, string> | undefined> {
  const { secrets } = await readUser(user);
  if (!secrets.length) return undefined;
  return Object.fromEntries(secrets.map((s) => [s.name, open(s.value)]));
}
