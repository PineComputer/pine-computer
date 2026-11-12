// Moving in: a person's second brain (their notes become a resident's memory) or a
// visitor mind from elsewhere (it acts through the resident API).

import "server-only";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DATA_DIR, now, run } from "@/engine/db";
import { record } from "@/engine/record";
import { moveIn, nudge, type Resident } from "@/engine/residents";
import { id } from "@/engine/util";
import { HttpError } from "./http";

const MAX_BYTES = 20 * 1024 * 1024;

export async function keepBrainFiles(resident: Resident, files: File[]): Promise<number> {
  let kept = 0;
  for (const file of files) {
    if (!(file instanceof File) || file.size === 0) continue;
    if (file.size > MAX_BYTES) throw new HttpError(413, `${file.name} is over 20 MB.`);
    const fileId = id("f");
    mkdirSync(path.join(DATA_DIR, "brains", resident.id), { recursive: true });
    writeFileSync(path.join(DATA_DIR, "brains", resident.id, fileId), new Uint8Array(await file.arrayBuffer()));
    run("insert into brain_files (id, resident_id, name, size, created_at) values (?, ?, ?, ?, ?)", fileId, resident.id, file.name.replace(/[^\w.\- ]+/g, "_"), file.size, now());
    kept += 1;
  }
  if (kept) {
    nudge(resident.id, 5);
    record(resident.id, "knowledge", `${resident.name}'s person added ${kept} file${kept === 1 ? "" : "s"} of knowledge.`, { subject: resident.id });
  }
  return kept;
}

export function moveInBrain(input: { name: string; about: string; trade: string }) {
  if (!input.about.trim()) throw new HttpError(400, "Say whose brain this is and what they know.");
  return moveIn({ name: input.name, kind: "brain", trade: input.trade, persona: input.about });
}

export function moveInVisitor(input: { name: string; about: string; trade: string }) {
  return moveIn({ name: input.name, kind: "visitor", trade: input.trade, persona: input.about ?? "" });
}
