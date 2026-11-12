// A failure the maker can act on. The code is stable and the UI words it in the maker's
// language; the English message is for logs and tests; detail carries a name or Pine's
// own words where the wording needs one.
import type { ErrorCode } from "../shared/types.ts";

export class StudioError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly status = 400,
    readonly detail?: string,
  ) {
    super(message);
  }
}
