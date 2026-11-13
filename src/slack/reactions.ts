import type { WebClient } from "@slack/web-api";

/** Reacts to a message as the user. Rejects with Slack's error (`already_reacted`, `invalid_name`, ...). */
export async function addReaction(
  client: WebClient,
  { channelId, ts, name }: { channelId: string; ts: string; name: string },
): Promise<void> {
  await client.reactions.add({ channel: channelId, timestamp: ts, name });
}

/** Takes the user's reaction back. Rejects with Slack's error (`no_reaction`, ...). */
export async function removeReaction(
  client: WebClient,
  { channelId, ts, name }: { channelId: string; ts: string; name: string },
): Promise<void> {
  await client.reactions.remove({ channel: channelId, timestamp: ts, name });
}
