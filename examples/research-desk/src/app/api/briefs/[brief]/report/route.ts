// The report as a Markdown file, written from this app's own record of it.

import { brand } from "@/brand";
import { markdown } from "@/shared/notes";
import { briefView } from "@/server/desk";
import { HttpError, route } from "@/server/http";
import { read } from "@/server/store";

export const dynamic = "force-dynamic";

export const GET = route<{ brief: string }>(async (_request, { brief }) => {
  const view = await briefView(brief);
  if (!view.report) throw new HttpError(404, "This brief has no report yet.");
  const { readers } = await read();
  const text = markdown(view.question, view.report, (id) => readers.find((r) => r.id === id)?.name ?? "a reader");
  const name = `${(view.report.title || brand.name).replace(/[^\w -]+/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "report"}.md`;
  return new Response(text, {
    headers: { "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" },
  });
});
