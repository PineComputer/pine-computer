import {
  ApiError,
  CapacityExceededError,
  CreateRateLimitedError,
  LifecycleError,
  PineError,
  ProblemType,
  SandboxRetainedError,
} from "@pinesandbox/computer";

export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/** Answers with JSON that no cache may keep: everything here is about a Computer, now. */
export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

const PROBLEM_WORDS: Record<string, [number, string]> = {
  [ProblemType.sessionBusy]: [409, "It is busy in this thread. Wait for it, or stop the job."],
  [ProblemType.sessionLimit]: [409, "Its Computer is running as many threads as it can."],
  [ProblemType.staleTurn]: [409, "That question has moved on. Answer the latest one instead."],
  [ProblemType.controlNotHeld]: [409, "Someone else has the controls."],
  [ProblemType.featureDisabled]: [403, "Your project doesn't have this feature."],
};

/** A failure as a status and a sentence the page can show as is. Unexpected ones are logged here and stay here. */
export function explain(error: unknown): { status: number; error: string; requestId?: string } {
  if (error instanceof HttpError) return { status: error.status, error: error.message };
  if (error instanceof SandboxRetainedError) return { status: 409, error: "The Computer is still running. Stop it first." };
  if (error instanceof CapacityExceededError) return { status: 429, error: "Your project is running as many Computers as it may." };
  if (error instanceof CreateRateLimitedError) return { status: 429, error: "Too many Computers started this minute. Try again shortly." };
  if (error instanceof LifecycleError) return { status: error.status >= 500 ? 502 : error.status, error: words(error.message), requestId: error.requestId };
  if (error instanceof ApiError) {
    const known = PROBLEM_WORDS[error.problemType];
    if (known) return { status: known[0], error: known[1], requestId: error.requestId };
    return { status: error.status >= 500 ? 502 : error.status, error: words(error.detail || error.title || error.message), requestId: error.requestId };
  }
  if (error instanceof PineError) return { status: 502, error: words(error.message) };
  console.error(error);
  return { status: 500, error: "Something went wrong. The server's log has the details." };
}

export function failure(error: unknown): Response {
  const { status, ...body } = explain(error);
  return json(body, status);
}

/** The SDK's messages, as a sentence: without its prefix, status and request details. */
export function words(message: string): string {
  const text = message
    .replace(/^pinesandbox:\s*/, "")
    .replace(/^lifecycle \d+:\s*/i, "")
    .replace(/\s*\((?:host|op|request_id)=[^)]*\)$/, "");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

type Handler<P> = (request: Request, params: P) => Promise<unknown>;

/**
 * A route handler that answers with what it returns (a Response, or JSON) and turns a
 * thrown error into a failure the page can show.
 */
export function route<P = Record<string, never>>(handler: Handler<P>) {
  return async (request: Request, context: { params: Promise<P> }): Promise<Response> => {
    try {
      const result = await handler(request, await context.params);
      return result instanceof Response ? result : json(result ?? {});
    } catch (error) {
      return failure(error);
    }
  };
}

export async function body<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new HttpError(400, "Send a JSON body.");
  }
}

export function required(value: string | undefined, message: string): string {
  const text = value?.trim();
  if (!text) throw new HttpError(400, message);
  return text;
}
