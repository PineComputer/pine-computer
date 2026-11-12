// The countries a Computer's browser can reach the internet from, and the project's
// limits for new sandboxes.

import { route } from "@/server/http";
import { client } from "@/server/pine";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const [locations, policy] = await Promise.all([client().availableLocations(), client().projectPolicy()]);
  return { locations: locations.locations, defaultLocation: locations.defaultLocation, policy };
});
