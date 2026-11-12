import { route } from "@/server/http";
import { residentDetail } from "@/engine/views";

export const dynamic = "force-dynamic";

export const GET = route<{ name: string }>(async (_request, { name }) => residentDetail(decodeURIComponent(name)));
