import type { WebClient } from "@slack/web-api";
import { fetchChannelDetails } from "../slack/conversations";
import type { ChannelDetails } from "../slack/convert";
import { callSlack, type CommandResult } from "./conversationCommand";
import { describeFailure } from "./failureText";

export type ChannelDetailsResult = CommandResult<{ details: ChannelDetails }>;

const detailsFailures: Record<string, string> = {
  channel_not_found: "Slack can't find this channel (it's private, or gone).",
  method_not_supported_for_channel_type:
    "Slack has no details to show for that kind of conversation.",
};

/** Why a channel's details couldn't be loaded, in words for the popup. */
export function describeDetailsFailure(error: unknown): string {
  return describeFailure(error, {
    failures: detailsFailures,
    missingScope:
      "To show channel details termslack needs the channels:read permission (groups:read for a private channel). Run termslack's setup again to grant it.",
    refused: "Slack refused to show the channel's details",
    couldnt: "Couldn't load the channel's details",
  });
}

/**
 * Loading a channel's details: asked of Slack every time, so what the popup
 * shows is current. Before answering, the people and channels the topic and
 * description mention, and the creator, are looked up so they show by name.
 */
export function createChannelDetails({
  client,
  resolveText,
  resolveUser,
}: {
  client: () => WebClient;
  resolveText(text: string): Promise<void>;
  resolveUser(id: string): Promise<void>;
}): (conversationId: string) => Promise<ChannelDetailsResult> {
  return async (id) => {
    const loaded = await callSlack({
      problem: undefined,
      call: () => fetchChannelDetails(client(), id),
      describe: describeDetailsFailure,
    });

    if (!loaded.ok) {
      return loaded;
    }

    const details = loaded.value;

    await Promise.all([
      resolveText(details.topic),
      resolveText(details.description),
      details.creatorId ? resolveUser(details.creatorId) : undefined,
    ]);

    return { ok: true, details };
  };
}
