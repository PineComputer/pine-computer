// The system's credential store, for the one key that seals the studio's secrets: the
// macOS Keychain, or the Secret Service on Linux (secret-tool). Elsewhere, or when the
// store isn't there, callers fall back to a key file; the desktop shell will hand the key
// over from Electron's safeStorage instead. One entry per data folder.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { DATA_DIR } from "./config.ts";

const SERVICE = "Pine Drama Studio";
const ACCOUNT = createHash("sha256").update(DATA_DIR).digest("hex").slice(0, 16);

function call(command: string, args: string[], input?: string): string | undefined {
  const result = spawnSync(command, args, { input, encoding: "utf8", timeout: 10_000 });
  return result.status === 0 ? result.stdout.trim() : undefined;
}

export function readKey(): string | undefined {
  if (process.platform === "darwin") return call("/usr/bin/security", ["find-generic-password", "-s", SERVICE, "-a", ACCOUNT, "-w"]) || undefined;
  if (process.platform === "linux") return call("secret-tool", ["lookup", "service", SERVICE, "account", ACCOUNT]) || undefined;
  return undefined;
}

/** Saves the key; true once it reads back the same. The key goes in on stdin, never on a command line. */
export function writeKey(key: string): boolean {
  if (process.platform === "darwin") call("/usr/bin/security", ["-i"], `add-generic-password -U -s "${SERVICE}" -a ${ACCOUNT} -w ${key}\n`);
  else if (process.platform === "linux") call("secret-tool", ["store", `--label=${SERVICE}`, "service", SERVICE, "account", ACCOUNT], key);
  else return false;
  return readKey() === key;
}
