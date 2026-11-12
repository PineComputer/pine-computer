import { ApiError, PineError } from "@pinesandbox/computer";
import { words } from "@/engine/util";

export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/** A failure the page can show as is; unexpected ones stay in the server log. */
export function failure(error: unknown): Response {
  if (error instanceof HttpError) return json({ error: error.message }, error.status);
  if (error instanceof ApiError) return json({ error: words(error.detail || error.message) }, error.status >= 500 ? 502 : error.status);
  if (error instanceof PineError) return json({ error: words(error) }, 502);
  if (error instanceof Error && !(error instanceof TypeError) && !(error instanceof RangeError)) return json({ error: error.message }, 400);
  console.error(error);
  return json({ error: "Something went wrong. The server's log has the details." }, 500);
}

type Handler<P> = (request: Request, params: P) => Promise<unknown>;

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

export function bearer(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) throw new HttpError(401, "Send your token as Authorization: Bearer <token>.");
  return token;
}
