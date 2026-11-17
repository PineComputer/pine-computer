// A run's report as a Markdown file, to attach to an issue. The page's Print view is
// the same report with its screens, for a PDF.

import { HttpError, route } from "@/server/http";
import { read } from "@/server/store";
import { view } from "@/server/view";
import { fileName, markdown } from "@/shared/report";

export const dynamic = "force-dynamic";

export const GET = route<{ run: string }>(async (_request, { run }) => {
  const data = await read();
  const found = data.runs.find((r) => r.id === run);
  if (!found) throw new HttpError(404, "That run isn't kept here.");
  return new Response(markdown(view(found, data)), {
    headers: { "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": `attachment; filename="${fileName(found)}"`, "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" },
  });
});
