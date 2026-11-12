// Seals what the studio keeps about its Computers and the maker's project key (credentials,
// bindings, session tokens, the API key) with AES-256-GCM. The sealing key is made on first
// run and kept apart from what it seals: in the system's credential store (keychain.ts),
// or handed over by the desktop shell as STUDIO_SECRET. Only where neither exists does it
// fall back to a file in the data folder, readable by the maker's account alone.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./config.ts";
import { readKey, writeKey } from "./keychain.ts";

let cached: Buffer | undefined;

function sealingKey(): string {
  if (process.env.STUDIO_SECRET) return process.env.STUDIO_SECRET;
  const stored = readKey();
  if (stored) return stored;
  const file = path.join(DATA_DIR, "secret.key");
  // A key from before the credential store: move it there, so the folder alone opens nothing.
  const key = existsSync(file) ? readFileSync(file, "utf8").trim() : randomBytes(32).toString("base64");
  if (writeKey(key)) {
    rmSync(file, { force: true });
    return key;
  }
  if (!existsSync(file)) {
    mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
    writeFileSync(file, key, { mode: 0o600 });
  }
  return key;
}

function key(): Buffer {
  cached ??= Buffer.from(sealingKey(), "base64");
  if (cached.length !== 32) throw new Error("The sealing key must be 32 bytes, base64.");
  return cached;
}

export function seal(text: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return "v1:" + Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
}

export function unseal(sealed: string): string {
  if (!sealed.startsWith("v1:")) throw new Error("Unknown sealed format.");
  const raw = Buffer.from(sealed.slice(3), "base64");
  const decipher = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}
