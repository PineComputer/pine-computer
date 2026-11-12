// Runs a command in the session's shell and streams its output as it comes, one JSON
// object per line: {type: "stdout" | "stderr", text}, then {type: "exit", exitCode}.

import { ApiError } from "@pinesandbox/computer";
import { body, required, route, words } from "@/server/http";
import { requireSession } from "@/server/pine";
import { currentUser } from "@/server/user";

export const dynamic = "force-dynamic";

export const POST = route<{ session: string }>(async (request, { session }) => {
  const command = required((await body<{ command?: string }>(request)).command, "Type a command.");
  const target = await requireSession(await currentUser(), session);
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (line: Record<string, unknown>) => controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
      const run = () =>
        target.exec(command, {
          timeoutMs: 120_000,
          signal: request.signal,
          onEvent: (event) => {
            if (event.type === "stdout" || event.type === "stderr") write({ type: event.type, text: String(event.text ?? "") });
          },
        });
      try {
        let result;
        try {
          result = await run();
        } catch (error) {
          // The shell was lost in a restart: build it again and run once more.
          if (!(error instanceof ApiError && error.code === "terminal_lost")) throw error;
          await target.recreateTerminal();
          result = await run();
        }
        write({ type: "exit", exitCode: result.exitCode ?? null, error: result.error || undefined });
      } catch (error) {
        if (!request.signal.aborted) write({ type: "error", text: error instanceof Error ? words(error.message) : "The command failed." });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
});
