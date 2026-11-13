import type { Presence } from "../../session/events";
import { isObject } from "./shared";

/** Reads `presence` from a `users.getPresence` response; undefined when it is neither `active` nor `away`. */
export function convertPresence(raw: unknown): Presence | undefined {
  if (!isObject(raw)) {
    return undefined;
  }

  return raw.presence === "active" || raw.presence === "away"
    ? raw.presence
    : undefined;
}
