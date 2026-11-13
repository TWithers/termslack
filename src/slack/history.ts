import type { WebClient } from "@slack/web-api";
import type { Message } from "../session/events";
import { compareTs } from "../session/workspaceStore";
import { convertMessagesPage, type MessagesPage } from "./convert";
import { slackErrorCode } from "./errors";

export type PageOptions = {
  cursor?: string;
  limit?: number;
};

/** One page of a conversation's messages, newest first. Rejects with Slack's error. */
export async function fetchHistoryPage(
  client: WebClient,
  channelId: string,
  { cursor, limit }: PageOptions = {},
): Promise<MessagesPage> {
  return convertMessagesPage(
    channelId,
    await client.conversations.history({ channel: channelId, cursor, limit }),
  );
}

/** One page of a thread, oldest first; the first page starts with the parent. Rejects with Slack's error. */
export async function fetchRepliesPage(
  client: WebClient,
  channelId: string,
  threadTs: string,
  { cursor, limit }: PageOptions = {},
): Promise<MessagesPage> {
  return convertMessagesPage(
    channelId,
    await client.conversations.replies({
      channel: channelId,
      ts: threadTs,
      cursor,
      limit,
    }),
  );
}

/** The newest message of a conversation: its `ts`, none (empty), gone (no access) or a failed call. */
export type NewestMessage =
  | { status: "found"; ts?: string; message?: Message }
  | { status: "gone" }
  | { status: "failed" };

const goneErrors = new Set(["channel_not_found"]);

/** Asks for just the newest message of a conversation. Never rejects. */
export async function fetchNewestMessage(
  client: WebClient,
  channelId: string,
): Promise<NewestMessage> {
  try {
    const page = convertMessagesPage(
      channelId,
      await client.conversations.history({ channel: channelId, limit: 1 }),
    );
    const message = [...page.messages].sort((a, b) => compareTs(b.ts, a.ts))[0];

    return { status: "found", ts: message?.ts, message };
  } catch (error) {
    return goneErrors.has(slackErrorCode(error) ?? "")
      ? { status: "gone" }
      : { status: "failed" };
  }
}
