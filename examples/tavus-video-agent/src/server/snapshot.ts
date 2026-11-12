import "server-only";
import type { Snapshot } from "@/shared/api";
import { currentNudge, toView } from "./claim";
import { PORTAL_URL } from "./config";
import { recentSteps } from "./live";
import { view } from "./pine";
import { portalStaff } from "./portal";
import { read } from "./store";
import { palInfo, tavusConfigured } from "./tavus";

export async function snapshot(): Promise<Snapshot> {
  const data = await read();
  return {
    computer: await view().catch(() => ({ state: "unknown" })),
    claim: toView(data.claim),
    steps: recentSteps(),
    tavus: { configured: tavusConfigured(), palId: process.env.TAVUS_PAL_ID, ...(tavusConfigured() ? await palInfo().catch(() => ({ name: "Riley", mode: "pal" as const })) : { name: "Riley", mode: "pal" as const }) },
    portal: { url: PORTAL_URL, staff: portalStaff() },
    nudge: await currentNudge(),
  };
}
