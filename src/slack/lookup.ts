import type { LookupResult } from "../session/nameResolver";
import { slackErrorCode } from "./errors";

/**
 * Runs one Slack lookup. An undefined answer (a payload that didn't convert)
 * or an error not listed in `definiteErrors` is a temporary failure; the
 * listed errors are definite answers, so the ID is never asked about again.
 */
export async function lookup<T>(
  call: () => Promise<T | undefined>,
  definiteErrors: ReadonlySet<string>,
): Promise<LookupResult<T>> {
  try {
    const value = await call();

    return value === undefined
      ? { status: "failed" }
      : { status: "found", value };
  } catch (error) {
    return definiteErrors.has(slackErrorCode(error) ?? "")
      ? { status: "unresolvable" }
      : { status: "failed" };
  }
}
