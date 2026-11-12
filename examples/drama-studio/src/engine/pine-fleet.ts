// The Fleet on Pine's server SDK. Each call rebuilds its handle from the saved records,
// as the starter does, so any request or a restarted engine picks up where the last left off.
import { createHash } from "node:crypto";
import {
  Binding,
  CapacityExceededError,
  Client,
  CreateRateLimitedError,
  Credentials,
  NotFoundError,
  SandboxFailedError,
  SandboxRetainedError,
  UnknownComputerError,
  type AgentTurn,
  type Computer,
  type ProjectPolicy,
  type Session,
} from "@pinesandbox/computer";
import type { Attached, ComputerRef, Fleet, FleetEvent, Limits, SessionRef, TurnInfo } from "./fleet.ts";

/** What the studio keeps of the project's policy. */
export function limitsOf(policy: ProjectPolicy): Limits {
  return {
    maxComputers: policy.maxConcurrentComputers,
    maxIdleSeconds: policy.lifecycle?.maxIdleTimeoutSeconds ?? null,
    idleAdjustable: policy.lifecycle !== null,
    maxRuntimeSeconds: policy.lifecycle?.maxRuntimeAgeSeconds ?? null,
  };
}

/** Marks the errors that mean "the project is busy, try later" (fleet.ts, isBusy), and passes the error on. */
function busyOr(error: unknown): never {
  if (error instanceof CapacityExceededError || error instanceof CreateRateLimitedError) throw Object.assign(error, { retryLater: true });
  throw error;
}

/**
 * What the agent wrote, with real line breaks: its summaries and questions sometimes carry them
 * written out as "\n", which would run an episode list or a Markdown list into one line.
 */
export function said(text: string): string {
  return text.replace(/(?<!\\)(?:\\r)?\\n/g, "\n").replace(/(?<!\\)\\t/g, "\t");
}

/**
 * A turn's cost and the additional charges in it (generated video). Pine prices the total as
 * the model use plus those charges, so where a release doesn't name them they are the rest.
 */
function priced(cost: { total?: unknown; llm?: unknown; additional?: unknown } | undefined): { cost: number | null; media: number | null } {
  const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
  const total = number(cost?.total);
  const llm = number(cost?.llm);
  const additional = cost && "additional" in cost ? number(cost.additional) : total !== null && llm !== null ? Math.max(0, Math.round((total - llm) * 1e6) / 1e6) : null;
  return { cost: total, media: additional };
}

function turnInfo(turn: AgentTurn): TurnInfo {
  return {
    turnId: turn.turnId,
    state: turn.state,
    question: said(turn.question),
    summary: said(turn.result?.summary ?? ""),
    nextTurnId: turn.nextTurnId,
    files: (turn.result?.artifacts ?? []).map((file) => ({
      path: file.relativePath,
      size: file.size,
      sha256: file.sha256,
      type: file.contentType,
    })),
    ...priced(turn.result?.usage.cost),
  };
}

export class PineFleet implements Fleet {
  readonly mode = "pine" as const;
  readonly project: string;
  private readonly client: Client;

  constructor(project: { endpoint: string; apiKey: string; controlHost?: string }) {
    this.client = new Client({ endpoint: project.endpoint, apiKey: project.apiKey, controlHost: project.controlHost });
    // A new key for the same project reads as another project: its Computers are made afresh.
    this.project = createHash("sha256").update(`${project.endpoint}\n${project.apiKey}`).digest("hex").slice(0, 16);
  }

  private computer(ref: ComputerRef): Computer {
    return this.client.reconnectComputer(Credentials.parse(ref.credentials), Binding.parse(ref.binding));
  }

  private session(ref: ComputerRef, session: SessionRef): Session {
    return this.computer(ref).adoptSession(session.name, session.token);
  }

  private attached(computer: Computer): Attached {
    return { binding: computer.binding().serialize(), revision: computer.bindingRevision.toString() };
  }

  async limits() {
    return limitsOf(await this.client.projectPolicy());
  }

  async newCredentials() {
    const credentials = await Credentials.generate();
    return { id: credentials.id, credentials: credentials.serialize() };
  }

  async createComputer(credentials: string, label: string, idleTimeoutSeconds: number) {
    try {
      const computer = await this.client.createComputer({
        credentials: Credentials.parse(credentials),
        idleTimeoutSeconds,
        metadata: { app: "pine-drama-studio", label },
      });
      return this.attached(computer);
    } catch (error) {
      return busyOr(error);
    }
  }

  /**
   * Starts the Computer these credentials name, whatever state the studio lost track of it in:
   * never registered (a Create whose answer was lost) creates it with the same identity; still
   * running or paused with no binding left to reach it stops it by id first; failed is
   * recovered from its saved state, as Pine's lifecycle guide says.
   */
  async startComputer(credentials: string, label: string, idleTimeoutSeconds: number) {
    const parsed = Credentials.parse(credentials);
    try {
      return this.attached(await this.client.startComputer(parsed, { idleTimeoutSeconds }));
    } catch (error) {
      if (error instanceof UnknownComputerError) return this.createComputer(credentials, label, idleTimeoutSeconds);
      try {
        if (error instanceof SandboxRetainedError) {
          await this.client.stopComputer(parsed.id);
          return this.attached(await this.client.startComputer(parsed, { idleTimeoutSeconds }));
        }
        if (error instanceof SandboxFailedError) return this.attached(await this.client.recoverComputer(parsed, { idleTimeoutSeconds }));
      } catch (again) {
        return busyOr(again);
      }
      return busyOr(error);
    }
  }

  async status(ref: ComputerRef) {
    try {
      return (await this.computer(ref).status()).toLowerCase();
    } catch (error) {
      if (error instanceof NotFoundError) return "stopped";
      throw error;
    }
  }

  async stopBy(ref: ComputerRef) {
    // stopAt: the graceful Stop starts here, twelve minutes before the hard deadline.
    const lifetime = (await this.computer(ref).sandboxDetails()).lifetime;
    return lifetime?.stopAt ?? lifetime?.deadline;
  }

  async skills(ref: ComputerRef) {
    const listed = await this.computer(ref).skills.list();
    return listed.filter((skill) => skill.enabled !== false).map((skill) => String(skill.name));
  }

  async setIdleTimeout(ref: ComputerRef, seconds: number) {
    return (await this.computer(ref).setIdleTimeout(seconds)).lifetime?.idleTimeoutSeconds ?? seconds;
  }

  async stop(ref: ComputerRef) {
    return this.computer(ref).stop();
  }

  async createSession(ref: ComputerRef, label: string) {
    const session = await this.computer(ref).createSession({ label, browser: true });
    return { name: session.name, token: session.token };
  }

  async closeSession(ref: ComputerRef, name: string) {
    await this.computer(ref).destroySession(name, { clean: true });
  }

  async writeFile(ref: ComputerRef, session: SessionRef, name: string, content: Uint8Array) {
    await this.session(ref, session).writeFile(name, content);
  }

  async run(ref: ComputerRef, session: SessionRef, goal: string, key: string, maxWallMs?: number) {
    const turn = await this.session(ref, session).agent.run(goal, {
      idempotencyKey: key,
      ...(maxWallMs ? { constraints: { maxWallMs } } : {}),
    });
    return turnInfo(turn);
  }

  async wait(ref: ComputerRef, session: SessionRef, turnId: string, timeoutMs: number) {
    return turnInfo(await this.session(ref, session).agent.wait(turnId, { timeoutMs }));
  }

  async answer(ref: ComputerRef, session: SessionRef, turnId: string, text: string) {
    return turnInfo(await this.session(ref, session).agent.answer(turnId, text));
  }

  async steer(ref: ComputerRef, session: SessionRef, turnId: string, text: string) {
    await this.session(ref, session).agent.steer(turnId, text);
  }

  async openFile(ref: ComputerRef, session: SessionRef, path: string) {
    return this.session(ref, session).openFile(path);
  }

  async listFiles(ref: ComputerRef, session: SessionRef, folder: string) {
    const entries = await this.session(ref, session).listFiles({ path: folder });
    return entries.map((entry) => ({ path: entry.relativePath, folder: entry.isDir, size: entry.size }));
  }

  async *events(ref: ComputerRef, session: SessionRef, after: string | undefined, taskId: string | undefined, signal: AbortSignal): AsyncIterable<FleetEvent> {
    const agent = this.session(ref, session).agent;
    for await (const event of agent.events({ lastEventId: after, expectedTaskId: taskId, frames: false, signal })) {
      const base = { id: String(event.eventId), taskId: event.taskId, turnId: event.turnId };
      const input = event.input();
      if (input) yield { ...base, kind: "input", text: input.text };
      const progress = event.progress();
      if (progress) yield { ...base, kind: "progress", text: said(progress.text) };
      const activity = event.activity();
      if (activity) yield { ...base, kind: "activity", text: activity.title, ref: activity.id, state: activity.state };
      const result = event.result();
      if (result) yield { ...base, kind: "result", text: said(result.summary) };
      // The turn's usage as it settles, its additional charges included; it may come after the result.
      const usage = event.type === "usage" ? (event.payload.usage as { cost?: Record<string, unknown> } | undefined) : undefined;
      if (usage?.cost) yield { ...base, kind: "usage", text: "", ...priced(usage.cost) };
    }
  }

  async desktop(ref: ComputerRef, session: SessionRef) {
    return this.computer(ref).delegateDesktop(session.name);
  }
}
