import type { WebClient } from "@slack/web-api";
import type { DndStatus } from "../session/events";
import { convertDndStatus } from "./convert";

/** The current user's Do Not Disturb. Rejects with Slack's error, or when the answer isn't one. */
export async function fetchDndStatus(client: WebClient): Promise<DndStatus> {
  const status = convertDndStatus(await client.dnd.info());

  if (!status) {
    throw new Error("dnd.info answered without dnd_enabled");
  }

  return status;
}
