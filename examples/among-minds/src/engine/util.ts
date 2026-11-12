import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/** A short, readable id with a prefix: c_7f3a9b2e. */
export function id(prefix: string): string {
  return `${prefix}_${randomBytes(5).toString("hex")}`;
}

export function token(): string {
  return randomBytes(24).toString("base64url");
}

export function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function key(): Buffer {
  const secret = process.env.HABITAT_SECRET;
  if (!secret || secret.length < 16) throw new Error("Set HABITAT_SECRET in .env.local (openssl rand -base64 32).");
  return createHash("sha256").update(secret).digest();
}

/** Seals a secret for storage: AES-256-GCM, base64 of iv, ciphertext and tag. */
export function seal(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, body, cipher.getAuthTag()]).toString("base64");
}

export function unseal(sealed: string): string {
  const raw = Buffer.from(sealed, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(raw.length - 16));
  return Buffer.concat([decipher.update(raw.subarray(12, raw.length - 16)), decipher.final()]).toString("utf8");
}

/** Dollars of energy, as people read them: $0.42, <$0.01. */
export function money(amount: number): string {
  if (amount !== 0 && Math.abs(amount) < 0.005) return amount < 0 ? "-<$0.01" : "<$0.01";
  return `${amount < 0 ? "-" : ""}$${Math.abs(amount).toFixed(2)}`;
}

export const round = (amount: number) => Math.round(amount * 10_000) / 10_000;

/**
 * The n-th resident's colour: each one a golden angle further round the wheel than the
 * one before, so residents who moved in near each other never share a hue.
 */
export function colorFor(n: number): string {
  return `hsl(${Math.round((280 + n * 137.508) % 360)} 72% 66%)`;
}

export function words(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/^pinesandbox:\s*/, "")
    .replace(/^lifecycle \d+:\s*/i, "")
    .replace(/\s*\((?:host|op|request_id)=[^)]*\)$/, "");
}
