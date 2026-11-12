// Route handlers answer JSON that no cache keeps, and turn failures into words the page can show.

import "server-only";
import { ApiError, CapacityExceededError, PineError } from "@pinesandbox/computer";

export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export function failure(error: unknown): Response {
  if (error instanceof HttpError) return json({ error: error.message }, error.status);
  if (error instanceof CapacityExceededError) return json({ error: "The project is running as many Computers as it may." }, 429);
  if (error instanceof ApiError) return json({ error: error.detail || error.title || error.message, requestId: error.requestId }, error.status >= 500 ? 502 : error.status);
  console.error(error);
  if (error instanceof PineError) return json({ error: error.message }, 502);
  return json({ error: error instanceof Error ? error.message : "Something went wrong." }, 500);
}

type Handler<P> = (request: Request, params: P) => Promise<unknown>;

export function route<P = Record<string, never>>(handler: Handler<P>) {
  return async (request: Request, context: { params: Promise<P> }) => {
    try {
      const result = await handler(request, await context.params);
      return result instanceof Response ? result : json(result ?? { ok: true });
    } catch (error) {
      return failure(error);
    }
  };
}

export async function body<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new HttpError(400, "Send JSON.");
  }
}
