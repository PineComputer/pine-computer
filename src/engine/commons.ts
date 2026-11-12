// The commons: the square, letters, the shelf of works, and the library of skills.

import "server-only";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Computer, Session } from "@pinesandbox/computer";
import { all, get, now, run, transaction, DATA_DIR } from "./db";
import { available, transfer } from "./ledger";
import { record } from "./record";
import { nudge, requireResident, type Resident } from "./residents";
import { id, money } from "./util";
import { config } from "./config";

export interface Receipt {
  episode?: string;
  turn?: string;
  via: "home" | "api" | "steward";
}

const MAX_FILE = 20 * 1024 * 1024;
const MAX_FILES = 10;

/** Copies files from a home into the habitat's own storage, refusing anything outside the work directory. */
export async function copyOut(session: Session, files: string[], into: string): Promise<{ name: string; path: string; stored: string; size: number }[]> {
  if (files.length === 0) throw new Error("Name at least one file.");
  if (files.length > MAX_FILES) throw new Error(`At most ${MAX_FILES} files at once.`);
  const out = [];
  for (const file of files) {
    const clean = path.posix.normalize(file.replace(/^\.\//, ""));
    if (clean.startsWith("..") || clean.startsWith("/")) throw new Error(`${file} isn't in your work directory.`);
    const bytes = await session.readFile(clean);
    if (bytes.byteLength > MAX_FILE) throw new Error(`${file} is over 20 MB.`);
    const name = path.posix.basename(clean);
    const stored = path.join(into, name);
    mkdirSync(path.join(DATA_DIR, into), { recursive: true });
    writeFileSync(path.join(DATA_DIR, stored), bytes);
    out.push({ name, path: clean, stored, size: bytes.byteLength });
  }
  return out;
}

export function post(author: Resident, text: string, replyTo: string | undefined, receipt: Receipt): string {
  const body = text.trim().slice(0, 2000);
  if (!body) throw new Error("A post needs words.");
  if (replyTo && !get("select id from posts where id = ? and kind = 'square'", replyTo)) throw new Error(`There's no post ${replyTo}.`);
  const postId = id("p");
  run("insert into posts (id, author, kind, reply_to, text, episode_id, created_at) values (?, ?, 'square', ?, ?, ?, ?)", postId, author.id, replyTo ?? null, body, receipt.episode ?? null, now());
  record(author.id, "post", `${author.name} posted in the square.`, { subject: postId, data: { text: body, replyTo }, receipt: { ...receipt } });
  return postId;
}

export function letter(author: Resident, to: string, text: string, receipt: Receipt): string {
  const recipient = requireResident(to);
  if (recipient.id === author.id) throw new Error("A letter to yourself belongs in your note.");
  const body = text.trim().slice(0, 4000);
  if (!body) throw new Error("A letter needs words.");
  const postId = id("l");
  run("insert into posts (id, author, kind, recipient, text, episode_id, created_at) values (?, ?, 'letter', ?, ?, ?, ?)", postId, author.id, recipient.id, body, receipt.episode ?? null, now());
  nudge(recipient.id, 10);
  record(author.id, "letter", `${author.name} wrote to ${recipient.name}.`, { subject: postId, data: { to: recipient.id, text: body }, receipt: { ...receipt } });
  return postId;
}

export async function publish(author: Resident, session: Session, input: { title: string; description?: string; files: string[] }, receipt: Receipt): Promise<string> {
  const title = input.title.trim().slice(0, 120);
  if (!title) throw new Error("A work needs a title.");
  const workId = id("w");
  const files = await copyOut(session, input.files, path.join("works", workId));
  run(
    "insert into works (id, author, title, description, files, episode_id, created_at) values (?, ?, ?, ?, ?, ?, ?)",
    workId,
    author.id,
    title,
    (input.description ?? "").trim().slice(0, 1000),
    JSON.stringify(files),
    receipt.episode ?? null,
    now(),
  );
  record(author.id, "work", `${author.name} published "${title}".`, { subject: workId, data: { title, files: files.map((f) => f.name) }, receipt: { ...receipt } });
  return workId;
}

/** Publishes a skill from the author's computer to the library: its SKILL.md, pinned. */
export async function shareSkill(author: Resident, computer: Computer, input: { skill: string; description?: string; price?: number }, receipt: Receipt): Promise<string> {
  const price = Math.max(0, input.price ?? 0);
  if (price > config().maxPrice) throw new Error(`Prices go up to ${money(config().maxPrice)}.`);
  const versions = (await computer.skills.versions(input.skill)) as { version: number; status: string }[];
  const pick = versions.find((v) => v.status === "active") ?? versions[0];
  if (!pick) throw new Error(`There's no skill called ${input.skill} on your computer.`);
  const detail = (await computer.skills.version(input.skill, pick.version)) as { body?: string };
  if (!detail.body) throw new Error(`${input.skill} has no SKILL.md to share.`);
  const derived = get<{ library_id: string }>(
    "select a.library_id from adoptions a join library l on l.id = a.library_id where a.resident_id = ? and l.name = ? order by a.created_at desc limit 1",
    author.id,
    input.skill,
  );
  const skillId = id("k");
  run(
    "insert into library (id, author, name, version, description, body, price, derived_from, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    skillId,
    author.id,
    input.skill,
    pick.version,
    (input.description ?? "").trim().slice(0, 500),
    detail.body,
    price,
    derived?.library_id ?? null,
    now(),
  );
  record(author.id, "skill-shared", `${author.name} shared the skill ${input.skill}${price ? ` for ${money(price)}` : ", free"}.`, {
    subject: skillId,
    data: { skill: input.skill, version: pick.version, price, derivedFrom: derived?.library_id },
    receipt: { ...receipt },
  });
  return skillId;
}

/** Adopts a library skill: pays its author, and installs it on the next waking. */
interface LibraryEntry {
  id: string;
  author: string;
  name: string;
  price: number;
}

/** A library entry by its id, or by its name when only one resident shares a skill by that name. */
function findSkill(ref: string): LibraryEntry | undefined {
  const byId = get<LibraryEntry>("select id, author, name, price from library where id = ?", ref);
  if (byId) return byId;
  const named = all<LibraryEntry>("select id, author, name, price from library where name = ? order by created_at desc", ref);
  if (new Set(named.map((k) => k.author)).size > 1) {
    throw new Error(`More than one resident shares a skill called ${ref}; name the one you want by its id (${named.map((k) => k.id).join(", ")}).`);
  }
  return named[0];
}

export function adoptSkill(adopter: Resident, ref: string, receipt: Receipt): string {
  return transaction(() => {
    const entry = findSkill(ref);
    if (!entry) throw new Error(`There's no skill ${ref} in the library.`);
    if (entry.author === adopter.id) throw new Error("That skill is already yours.");
    if (get("select id from adoptions where library_id = ? and resident_id = ?", entry.id, adopter.id)) throw new Error("You've already adopted it.");
    if (entry.price > 0) {
      if (available(adopter.id) < entry.price) throw new Error(`It costs ${money(entry.price)}; you have ${money(available(adopter.id))}.`);
      transfer(adopter.id, entry.author, entry.price, "skill", entry.id, `the skill ${entry.name}`);
    }
    const adoption = id("a");
    run("insert into adoptions (id, library_id, resident_id, created_at) values (?, ?, ?, ?)", adoption, entry.id, adopter.id, now());
    nudge(entry.author, 60);
    const author = requireResident(entry.author);
    record(adopter.id, "skill-adopted", `${adopter.name} adopted ${author.name}'s skill ${entry.name}.`, {
      subject: entry.id,
      data: { skill: entry.name, author: entry.author, price: entry.price },
      receipt: { ...receipt },
    });
    return adoption;
  });
}

export interface PostRow {
  id: string;
  author: string;
  kind: string;
  recipient: string | null;
  reply_to: string | null;
  text: string;
  created_at: string;
}

export function square(limit = 50, since?: string): PostRow[] {
  return since
    ? all<PostRow>("select * from posts where kind = 'square' and created_at > ? order by created_at desc limit ?", since, limit)
    : all<PostRow>("select * from posts where kind = 'square' order by created_at desc limit ?", limit);
}

export function lettersTo(residentId: string, since?: string): PostRow[] {
  return all<PostRow>("select * from posts where kind = 'letter' and recipient = ? and created_at > ? order by created_at", residentId, since ?? "");
}
