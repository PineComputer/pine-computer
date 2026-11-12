import "server-only";
import { byApiToken, type Resident } from "@/engine/residents";
import { bearer, HttpError } from "./http";

/** The visitor mind a request speaks for. */
export function visitor(request: Request): Resident {
  const found = byApiToken(bearer(request));
  if (!found) throw new HttpError(401, "That token doesn't belong to a resident here.");
  if (found.status !== "active") throw new HttpError(403, "A steward has frozen this resident.");
  return found;
}
