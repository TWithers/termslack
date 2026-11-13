import type { WebClient } from "@slack/web-api";
import type { PostedMessage } from "../slack/convert";
import { slackErrorCode } from "../slack/errors";
import { postMessage } from "../slack/messages";
import type { ChangeTracker } from "./changeTracker";
import { replyParentOf, type Message, type MessageEvent } from "./events";
import { type Mention, type MentionDirectory, toSlackText } from "./mentions";
import { describeSendFailure } from "./outgoingText";

export type SendRequest = {
  conversationId: string;
  /** What the user typed. */
  text: string;
  /** Mentions picked from the completion list, so each keeps the ID that was picked. */
  mentions?: Mention[];
  /** Sends as a reply in this thread. */
  threadTs?: string;
  /** With `threadTs`: also shows the reply in the channel. */
  broadcast?: boolean;
};

/** Never rejects: a failure says why in words fit for the status bar. */
export type SendResult =
  { ok: true; ts: string } | { ok: false; message: string };

/** One message the user is sending, from the moment they send it until Slack confirms it. */
type Send = {
  clientMsgId: string;
  /** Where it shows until it has its own `ts`; see `pendingTs`. */
  pendingTs: string;
  conversationId: string;
  threadTs?: string;
  /** Also shown in the channel; the stored message is then a `thread_broadcast`. */
  broadcast: boolean;
  /** Slack text, as it will be stored. */
  text: string;
  state: "sending" | "failed";
};

/** How many confirmed `ts` values are kept for dropping late echoes. */
const confirmedLimit = 100;

type Held = { event: MessageEvent; record: () => Promise<void> };

export type Outgoing = {
  send(request: SendRequest): Promise<SendResult>;
  /** The messages being sent (or that failed) in a conversation's channel view (broadcast replies included), or in one thread, oldest first. */
  pending(conversationId: string, threadTs?: string): Message[];
  /**
   * Takes a message that arrived over the socket. `record` stores it. It runs
   * now, unless the message looks like the echo of a send whose `ts` isn't
   * known yet, in which case it runs once that is settled (see below).
   * Resolves when `record` has run, or at once when it was held.
   */
  receive(event: MessageEvent, record: () => Promise<void>): Promise<void>;
};

/**
 * Sending, and recognising our own messages when they come back.
 *
 * A send shows at once as a pending message, then Slack answers twice: the
 * `chat.postMessage` response and the message echoed over the socket, in
 * either order. The pending message must be replaced by whichever comes
 * first, and the other must add nothing.
 *
 * - The echo matches on `client_msg_id` when Slack carries it through.
 * - Otherwise `ts` is the only thing the response and echo share, so while a
 *   send is in flight an echo written by the current user in the same
 *   conversation and thread is held back until the response gives the `ts`.
 *   If the `ts` matches a send, the echo is dropped (the response stored the
 *   message already); if it matches none, it is somebody else's message (the
 *   user's phone, say) and is stored then. A failed send releases what it was
 *   holding, so holding never loses a message.
 */
export function createOutgoing({
  client,
  changes,
  mentionDirectory,
  currentUserId,
  writeProblem,
  storeMessage,
  now = Date.now,
}: {
  client: () => WebClient;
  changes: ChangeTracker;
  /** What typed `@name` and `#channel` are matched against. */
  mentionDirectory: () => MentionDirectory;
  currentUserId: () => string | undefined;
  /** Why sending is off (the token lacks `chat:write`), or undefined. */
  writeProblem: () => string | undefined;
  /** Stores the confirmed message the response described. */
  storeMessage: (message: Message) => void;
  now?: () => number;
}): Outgoing {
  const sends = new Map<string, Send>();
  /** `ts` values that responses have confirmed, per conversation, for dropping late echoes. */
  const confirmed = new Set<string>();
  let held: Held[] = [];
  let counter = 0;

  const key = (conversationId: string, ts: string) => `${conversationId}:${ts}`;

  /** Remembers a confirmed `ts`, forgetting the oldest beyond `confirmedLimit`: only echoes still in flight need it. */
  function confirm(conversationId: string, ts: string): void {
    confirmed.add(key(conversationId, ts));

    for (const oldest of confirmed) {
      if (confirmed.size <= confirmedLimit) {
        return;
      }

      confirmed.delete(oldest);
    }
  }

  /** The thread an event belongs to; undefined for the channel's own messages. */
  const threadOf = replyParentOf;

  function inFlight(conversationId: string, threadTs?: string): Send[] {
    return [...sends.values()].filter(
      (send) =>
        send.state === "sending" &&
        send.conversationId === conversationId &&
        send.threadTs === threadTs,
    );
  }

  /** Stores the held echoes that no send in flight might still be the owner of; drops the ones a response confirmed. */
  async function releaseHeld(): Promise<void> {
    const waiting = held;

    held = [];

    for (const entry of waiting) {
      const { event } = entry;

      if (confirmed.has(key(event.channelId, event.ts))) {
        continue;
      }

      if (inFlight(event.channelId, threadOf(event)).length > 0) {
        held.push(entry);
        continue;
      }

      await entry.record().catch(() => undefined);
    }
  }

  /**
   * Takes the held echo that shows `send` was posted although the call
   * failed (a dropped connection, a timeout): the user's own message in the
   * same place with the same text. A refusal from Slack never gets here.
   */
  function claimHeld(send: Send): Held | undefined {
    const index = held.findIndex(
      ({ event }) =>
        event.channelId === send.conversationId &&
        threadOf(event) === send.threadTs &&
        event.text === send.text,
    );

    return index === -1 ? undefined : held.splice(index, 1)[0];
  }

  function pendingMessage(send: Send): Message {
    return {
      channelId: send.conversationId,
      ts: send.pendingTs,
      threadTs: send.threadTs,
      userId: currentUserId(),
      text: send.text,
      files: [],
      isEdited: false,
      isDeleted: false,
      subtype: send.broadcast ? "thread_broadcast" : undefined,
      delivery: send.state === "failed" ? "failed" : "pending",
    };
  }

  /** The message to store once Slack has answered; a broadcast reply is marked so the channel lists it. */
  function confirmedMessage(send: Send, posted: PostedMessage): Message {
    const message = posted.message ?? {
      ...pendingMessage(send),
      ts: posted.ts,
      delivery: undefined,
    };

    return send.broadcast && message.subtype === undefined
      ? { ...message, subtype: "thread_broadcast" }
      : message;
  }

  return {
    pending(conversationId, threadTs) {
      return [...sends.values()]
        .filter(
          (send) =>
            send.conversationId === conversationId &&
            (send.threadTs === threadTs ||
              (threadTs === undefined && send.broadcast)),
        )
        .map(pendingMessage);
    },

    async receive(event, record) {
      const matched = event.clientMsgId && sends.get(event.clientMsgId);

      if (matched) {
        // `record` stores the message before its first wait, so the pending
        // message and the stored one are never both there to be drawn.
        sends.delete(matched.clientMsgId);
        confirm(event.channelId, event.ts);

        await record();
        await releaseHeld();

        return;
      }

      const mine =
        event.userId !== undefined && event.userId === currentUserId();

      if (mine && inFlight(event.channelId, threadOf(event)).length > 0) {
        held.push({ event, record });

        return;
      }

      await record();
    },

    async send({ conversationId, text, mentions, threadTs, broadcast }) {
      const problem = writeProblem();

      if (problem !== undefined) {
        return { ok: false, message: problem };
      }

      if (text.trim() === "") {
        return { ok: false, message: "There is nothing to send." };
      }

      for (const [id, send] of sends) {
        if (
          send.state === "failed" &&
          send.conversationId === conversationId &&
          send.threadTs === threadTs
        ) {
          sends.delete(id);
        }
      }

      const send: Send = {
        clientMsgId: crypto.randomUUID(),
        pendingTs: `${Math.floor(now() / 1000)}.p${++counter}`,
        conversationId,
        threadTs,
        broadcast: threadTs !== undefined && broadcast === true,
        text: toSlackText(text.trim(), mentionDirectory(), mentions),
        state: "sending",
      };

      sends.set(send.clientMsgId, send);
      changes.changed();

      try {
        const posted = await postMessage(client(), {
          channelId: conversationId,
          text: send.text,
          clientMsgId: send.clientMsgId,
          threadTs,
          broadcast,
        });

        confirm(conversationId, posted.ts);

        // An echo that carried our ID has already replaced the send.
        if (sends.delete(send.clientMsgId)) {
          storeMessage(confirmedMessage(send, posted));
        }

        changes.changed();
        await releaseHeld();

        return { ok: true, ts: posted.ts };
      } catch (error) {
        const posted = slackErrorCode(error) === undefined && claimHeld(send);

        if (posted) {
          sends.delete(send.clientMsgId);
          confirm(posted.event.channelId, posted.event.ts);
          await posted.record().catch(() => undefined);
          changes.changed();
          await releaseHeld();

          return { ok: true, ts: posted.event.ts };
        }

        send.state = "failed";
        changes.changed();
        await releaseHeld();

        return { ok: false, message: describeSendFailure(error) };
      }
    },
  };
}
