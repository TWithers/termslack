import type { WebClient } from "@slack/web-api";
import type { CustomEmoji } from "../session/events";
import type { LookupResult } from "../session/nameResolver";
import { convertCustomEmoji } from "./convert";

/** Every custom emoji in the workspace. */
export async function fetchCustomEmoji(
  client: WebClient,
): Promise<LookupResult<CustomEmoji[]>> {
  try {
    return {
      status: "found",
      value: convertCustomEmoji(await client.emoji.list()),
    };
  } catch {
    return { status: "failed" };
  }
}
