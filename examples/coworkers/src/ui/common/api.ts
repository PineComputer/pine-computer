// Calls to this app's own API. Its errors are sentences the page can show as they are.

export async function call<T = Record<string, unknown>>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = init.method ?? (init.body === undefined ? "GET" : "POST");
  const form = init.body instanceof FormData;
  const response = await fetch(path, {
    method,
    headers: init.body === undefined || form ? undefined : { "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : form ? (init.body as FormData) : JSON.stringify(init.body),
  });
  const answer = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(answer.error ?? `The request failed (${response.status}).`);
  return answer as T;
}

export const errorText = (error: unknown) => (error instanceof Error ? error.message : "Something went wrong.");

/** A session's path segment. */
export const enc = encodeURIComponent;
