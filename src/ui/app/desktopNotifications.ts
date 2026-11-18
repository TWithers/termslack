import {
  type Conversation,
  isChannel,
  isDirectMessage,
} from "../../session/events";
import type {
  Notification,
  NotifiedMessage,
} from "../../session/notifications";
import {
  conversationLabel,
  conversationTitle,
  personName,
} from "../../session/people";
import type { WorkspaceSession } from "../../session/workspaceSession";

/** What the app learned about the terminal it runs in. */
export type TerminalIdentity = {
  /** The name the terminal gives when asked for its version (XTVERSION). */
  name?: string;
  /** The `TERM_PROGRAM` environment variable. */
  termProgram?: string;
  /** What the terminal listed when asked about OSC 99, by key. */
  osc99?: Record<string, string[]>;
};

/** The escape code a terminal shows notifications through, or none. */
export type NotifierKind =
  | { code: "osc99"; critical: boolean }
  | { code: "osc777" }
  | { code: "osc9" }
  | { code: "none" };

/** Shows a desktop notification by writing an escape code to the terminal. */
export type DesktopNotifier = {
  show(notification: Notification): void;
};

export const maxBodyLength = 200;

export const noDesktopNotificationsNotice =
  "desktop notifications aren't supported by this terminal: the bell only";

/** Picks how to show notifications in a terminal: the first rule that matches its identity. */
export function chooseNotifierKind({
  name,
  termProgram,
  osc99,
}: TerminalIdentity): NotifierKind {
  if (osc99) {
    return { code: "osc99", critical: osc99.u?.includes("2") ?? false };
  }

  // Ticket 05: a kitty row goes here, ahead of solo, for answers whose `a` includes `report`.
  if (termProgram === "solo") {
    return { code: "osc99", critical: false };
  }

  if (name?.startsWith("ghostty") || termProgram === "ghostty") {
    return { code: "osc777" };
  }

  if (name?.startsWith("iTerm2") || termProgram === "iTerm.app") {
    return { code: "osc9" };
  }

  return { code: "none" };
}

/** The text with C0 and C1 control characters removed, so it can't end or inject an escape code. */
export function withoutControlCharacters(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f-\u009f]/g, "");
}

/**
 * The notifier for a kind, or undefined for `none`. Title and body are
 * worded by `describeNotification`; `write` sends the bytes to the terminal.
 */
export function createDesktopNotifier(
  kind: NotifierKind,
  session: WorkspaceSession,
  write: (bytes: string) => void,
): DesktopNotifier | undefined {
  if (kind.code === "none") {
    return undefined;
  }

  return {
    show(notification) {
      const { title, body } = describeNotification(session, notification);

      if (kind.code === "osc99") {
        const { conversationId, conversationKind } = notification.newest;

        write(
          osc99Sequence(
            title,
            body,
            conversationId,
            kind.critical && isDirectMessage(conversationKind),
          ),
        );

        return;
      }

      write(
        kind.code === "osc9"
          ? osc9Sequence(title, body)
          : osc777Sequence(title, body),
      );
    },
  };
}

/** Title and body as two base64 parts of one notification; `u=2` asks for critical urgency. */
function osc99Sequence(
  title: string,
  body: string,
  conversationId: string,
  critical: boolean,
): string {
  const id = `termslack-${conversationId}`;
  const encode = (text: string) =>
    Buffer.from(withoutControlCharacters(text), "utf8").toString("base64");

  return (
    `\x1b]99;i=${id}:d=0:e=1${critical ? ":u=2" : ""};${encode(title)}\x1b\\` +
    `\x1b]99;i=${id}:p=body:e=1;${encode(body)}\x1b\\`
  );
}

function osc777Sequence(title: string, body: string): string {
  const cleanTitle = withoutControlCharacters(title).replaceAll(";", ",");

  return `\x1b]777;notify;${cleanTitle};${withoutControlCharacters(body)}\x07`;
}

/**
 * OSC 9 has one text field. Text that starts with digits and a `;` is read
 * as a numbered sub-command (progress, for one), so that `;` becomes a comma.
 */
function osc9Sequence(title: string, body: string): string {
  const text = `${withoutControlCharacters(title)}: ${withoutControlCharacters(body)}`;

  return `\x1b]9;${text.replace(/^(\d+);/, "$1,")}\x07`;
}

function truncate(text: string, length: number): string {
  const chars = [...text];

  return chars.length <= length
    ? text
    : `${chars
        .slice(0, length - 1)
        .join("")
        .trimEnd()}…`;
}

function authorName(
  session: WorkspaceSession,
  message: NotifiedMessage,
): string {
  if (message.botName) {
    return message.botName;
  }

  if (message.userId) {
    return personName(session.user(message.userId), message.userId);
  }

  if (message.botId) {
    return session.bot(message.botId)?.name ?? "A bot";
  }

  return "Someone";
}

function conversationName(
  session: WorkspaceSession,
  conversationId: string,
): string {
  const conversation: Conversation | undefined =
    session.conversation(conversationId);
  const label = conversation && conversationLabel(conversation, session);

  if (!label) {
    return "a conversation";
  }

  return isChannel(conversation.kind)
    ? conversationTitle(conversation.kind, label)
    : label;
}

/**
 * What to show for a notification: the conversation and author for one
 * message, a count for a burst (with the newest message's text as the body).
 * Names come from the session as it is now.
 */
export function describeNotification(
  session: WorkspaceSession,
  { newest, messages, count, isBurst }: Notification,
): { title: string; body: string } {
  const where = conversationName(session, newest.conversationId);
  const author = authorName(session, newest);
  const text = truncate(newest.text || "New message", maxBodyLength);

  if (!isBurst) {
    return {
      title: where === author ? where : `${where} · ${author}`,
      body: text,
    };
  }

  const together = messages.every(
    (message) => message.conversationId === newest.conversationId,
  );

  return {
    title: `${count} new messages${together ? ` in ${where}` : ""}`,
    body: `${together ? author : `${where} · ${author}`}: ${text}`,
  };
}
