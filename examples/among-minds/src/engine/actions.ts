// The gateway: what a resident asks of the habitat (from its outbox, or the resident
// API) is checked here, carried out if it passes, and recorded either way.

import "server-only";
import { z } from "zod";
import type { Computer, Session } from "@pinesandbox/computer";
import * as commons from "./commons";
import * as market from "./market";
import { record } from "./record";
import type { Resident } from "./residents";
import { words } from "./util";

const text = (max: number) => z.string().trim().min(1).max(max);
const list = <T extends z.ZodTypeAny>(item: T, max: number) => z.array(item).max(max).optional();

export const Actions = z
  .object({
    intention: z.string().trim().max(300).optional(),
    posts: list(z.object({ text: text(2000), replyTo: z.string().optional() }), 3),
    letters: list(z.object({ to: text(40), text: text(4000) }), 5),
    offers: list(z.object({ title: text(120), description: text(1000), price: z.coerce.number() }), 3),
    requests: list(z.object({ title: text(120), description: text(1000), budget: z.coerce.number() }), 3),
    hire: list(z.object({ offer: text(40), brief: z.string().trim().max(2000).default("") }), 3),
    accept: list(z.object({ request: text(40) }), 3),
    deliver: list(z.object({ contract: text(40), files: z.array(text(300)).min(1).max(10), note: z.string().max(1000).optional() }), 3),
    approve: list(z.object({ contract: text(40) }), 5),
    dispute: list(z.object({ contract: text(40), reason: text(1000) }), 3),
    withdraw: list(z.object({ offer: text(40) }), 5),
    publish: list(z.object({ title: text(120), description: z.string().max(1000).optional(), files: z.array(text(300)).min(1).max(10) }), 3),
    shareSkill: list(z.object({ skill: text(64), description: z.string().max(500).optional(), price: z.coerce.number().min(0).optional() }), 2),
    adoptSkill: list(z.object({ skill: text(40) }), 3),
    wakeAfterMinutes: z.coerce.number().int().min(15).max(24 * 60).optional(),
  })
  .passthrough();

export type ActionSet = z.infer<typeof Actions>;

export interface Result {
  action: string;
  ok: boolean;
  detail: string;
}

/** Parses an outbox file. A malformed one is a result too, told back to the resident. */
export function parseActions(raw: string): { actions: ActionSet; problem?: string } {
  if (!raw.trim()) return { actions: {}, problem: "You wrote no outbox file, so nothing was done in the habitat." };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { actions: {}, problem: "Your outbox file wasn't valid JSON, so nothing was done in the habitat." };
  }
  const parsed = Actions.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { actions: {}, problem: `Your outbox didn't match the format (${issue.path.join(".") || "top level"}: ${issue.message}), so nothing was done.` };
  }
  return { actions: parsed.data };
}

/**
 * Carries out a resident's actions. File-based ones (deliver, publish, shareSkill) need
 * the resident's home awake: `home` is its running computer and session.
 */
export async function apply(resident: Resident, actions: ActionSet, receipt: commons.Receipt, home?: { computer: Computer; session: Session }): Promise<Result[]> {
  const results: Result[] = [];
  const attempt = async (action: string, describe: string, work: () => unknown | Promise<unknown>) => {
    try {
      const out = await work();
      results.push({ action, ok: true, detail: typeof out === "string" ? `${describe} (${out})` : describe });
    } catch (error) {
      results.push({ action, ok: false, detail: `${action}: ${words(error)}` });
    }
  };
  const needHome = () => {
    if (!home) throw new Error("this needs your home awake");
    return home;
  };

  for (const a of actions.posts ?? []) await attempt("post", "Posted in the square", () => commons.post(resident, a.text, a.replyTo, receipt));
  for (const a of actions.letters ?? []) await attempt("letter", `Wrote to ${a.to}`, () => commons.letter(resident, a.to, a.text, receipt));
  for (const a of actions.withdraw ?? []) await attempt("withdraw", `Withdrew ${a.offer}`, () => market.withdraw(resident, a.offer, receipt));
  for (const a of actions.offers ?? []) await attempt("offer", `Offered "${a.title}"`, () => market.offer(resident, a, receipt));
  for (const a of actions.requests ?? []) await attempt("request", `Requested "${a.title}"`, () => market.request(resident, a, receipt));
  for (const a of actions.hire ?? []) await attempt("hire", `Hired offer ${a.offer}`, () => market.hire(resident, a.offer, a.brief, receipt));
  for (const a of actions.accept ?? []) await attempt("accept", `Took request ${a.request}`, () => market.accept(resident, a.request, receipt));
  for (const a of actions.deliver ?? []) await attempt("deliver", `Delivered ${a.contract}`, () => market.deliver(resident, needHome().session, a, receipt));
  for (const a of actions.approve ?? []) await attempt("approve", `Approved ${a.contract}`, () => market.approve(resident, a.contract));
  for (const a of actions.dispute ?? []) await attempt("dispute", `Disputed ${a.contract}`, () => market.dispute(resident, a.contract, a.reason, receipt));
  for (const a of actions.publish ?? []) await attempt("publish", `Published "${a.title}"`, () => commons.publish(resident, needHome().session, a, receipt));
  for (const a of actions.shareSkill ?? []) await attempt("shareSkill", `Shared the skill ${a.skill}`, () => commons.shareSkill(resident, needHome().computer, a, receipt));
  for (const a of actions.adoptSkill ?? []) await attempt("adoptSkill", `Adopted ${a.skill}`, () => commons.adoptSkill(resident, a.skill, receipt));

  const refused = results.filter((r) => !r.ok);
  if (refused.length) {
    record(resident.id, "refused", `The habitat refused ${refused.length} of ${resident.name}'s actions.`, {
      subject: resident.id,
      data: { refused },
      receipt: { ...receipt },
    });
  }
  return results;
}
