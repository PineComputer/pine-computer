import { route } from "@/server/http";
import { client } from "@/server/pine";
import { diagnosticView } from "../view";

export const dynamic = "force-dynamic";

export const GET = route<{ id: string }>(async (_request, { id }) => diagnosticView(await client().getDiagnostic(id)));
