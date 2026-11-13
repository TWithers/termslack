import type { WebClient } from "@slack/web-api";
import { convertPostedMessage, type PostedMessage } from "./convert";

export type PostMessage = {
  channelId: string;
  /** Slack's mrkdwn text, already escaped. */
  text: string;
  /** Lets termslack recognise the socket echo of this message when Slack carries the ID through. */
  clientMsgId: string;
  /** Posts as a reply in this thread. */
  threadTs?: string;
  /** With `threadTs`: also shows the reply in the channel. */
  broadcast?: boolean;
};

/** Posts a message as the user. Rejects with Slack's error. */
export async function postMessage(
  client: WebClient,
  { channelId, text, clientMsgId, threadTs, broadcast }: PostMessage,
): Promise<PostedMessage> {
  const response = await client.chat.postMessage({
    channel: channelId,
    text,
    client_msg_id: clientMsgId,
    thread_ts: threadTs,
    reply_broadcast: threadTs !== undefined && broadcast ? true : undefined,
  } as Parameters<WebClient["chat"]["postMessage"]>[0]);
  const posted = convertPostedMessage(channelId, response);

  if (!posted) {
    throw new Error("Slack didn't say when the message was posted");
  }

  return posted;
}

/** Replaces the text of one of the user's own messages. Rejects with Slack's error. */
export async function updateMessage(
  client: WebClient,
  {
    channelId,
    ts,
    text,
  }: {
    channelId: string;
    ts: string;
    /** Slack's mrkdwn text, already escaped. */
    text: string;
  },
): Promise<void> {
  await client.chat.update({ channel: channelId, ts, text });
}

/** Deletes one of the user's own messages. Rejects with Slack's error. */
export async function deleteMessage(
  client: WebClient,
  { channelId, ts }: { channelId: string; ts: string },
): Promise<void> {
  await client.chat.delete({ channel: channelId, ts });
}
