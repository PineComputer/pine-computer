// Who drives the run's session: Pine's agent, or a person who took the controls in the
// page. While a person drives, the agent can't act; if it reaches for the browser it
// stops and asks for it back. So handing back also answers that question, and the run
// carries on from wherever the person left the page.

import "server-only";
import { question } from "@/shared/api";
import { requireSession, session } from "./pine";
import { answer, note, runOf } from "./runs";

const CARRY_ON = "The controls are yours again. Carry on with the checks from where the browser is now.";

export async function control(id: string, action: "take" | "release"): Promise<void> {
  const target = await requireSession(id);
  const state = action === "take" ? await target.takeControl() : await target.releaseControl();
  if (state.controller !== "human") return handedBack(id);
  if ((await runOf(id)).driving) return;
  await note(id, { kind: "took" }, (record) => {
    record.driving = { idleDeadline: state.idleDeadline?.toISOString() };
  });
}

/** The Computer hands the controls back by itself when a person sits idle: keep the run's picture of who drives true. */
export async function watchDriver(id: string): Promise<void> {
  const target = await session(id);
  if (!target || (await target.controlState()).controller === "human") return;
  await handedBack(id);
}

async function handedBack(id: string): Promise<void> {
  const run = await runOf(id);
  if (!run.driving) return;
  await note(id, { kind: "returned" }, (record) => {
    delete record.driving;
  });
  // A question asked while the person drove is the agent asking for the controls.
  const took = run.moments.findLast((m) => m.kind === "took")?.at ?? "";
  const asked = run.moments.findLast((m) => m.kind === "asked")?.at ?? "";
  if (run.state === "needs_input" && asked > took && !question(run.question ?? "").approval) await answer(id, CARRY_ON);
}
