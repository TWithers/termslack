import type { WebClient } from "@slack/web-api";
import type { Presence } from "../session/events";
import { convertPresence } from "./convert";
import { slackErrorCode } from "./errors";

/**
 * What asking Slack about one person's presence came to: `found`; `unknown`
 * (Slack won't say for this person, or answered with something unreadable);
 * `unavailable` (no call will work, e.g. the permission is missing); or
 * `failed` (temporary, such as a 429 that outlasted the client's retries).
 */
export type PresenceResult =
  | { status: "found"; presence: Presence }
  | { status: "unknown" | "unavailable" | "failed" };

const noSuchUserErrors = new Set(["user_not_found", "user_not_visible"]);

const unavailableErrors = new Set([
  "missing_scope",
  "not_allowed_token_type",
  "invalid_auth",
  "not_authed",
  "token_revoked",
  "token_expired",
  "account_inactive",
]);

/** Reads one person's presence (`users.getPresence`). Never rejects. */
export async function fetchPresence(
  client: WebClient,
  userId: string,
): Promise<PresenceResult> {
  try {
    const presence = convertPresence(
      await client.users.getPresence({ user: userId }),
    );

    return presence ? { status: "found", presence } : { status: "unknown" };
  } catch (error) {
    const code = slackErrorCode(error) ?? "";

    if (noSuchUserErrors.has(code)) {
      return { status: "unknown" };
    }

    return { status: unavailableErrors.has(code) ? "unavailable" : "failed" };
  }
}
