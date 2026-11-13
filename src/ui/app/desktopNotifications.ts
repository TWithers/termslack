import { type Conversation, isChannel } from "../../session/events";
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

/** Shows a desktop notification. Never throws and never waits for the desktop. */
export type DesktopNotifier = {
  show(title: string, body: string): void;
  /** Why notifications can't be shown here (an unsupported platform, a missing tool); the app says so once. */
  unavailable?: string;
};

/** A started notification command, as much as the notifier needs of a process. */
export type NotifierProcess = {
  exited: Promise<number>;
  kill(): void;
};

export const notificationTimeoutMs = 5000;
export const maxBodyLength = 200;

/**
 * The command that shows a notification, or undefined on a platform with no
 * known tool. Title and body are separate arguments (after `--`, so text
 * starting with `-` isn't read as an option), never part of a script or a
 * shell string.
 */
export function notificationCommand(
  platform: string,
  title: string,
  body: string,
): string[] | undefined {
  if (platform === "darwin") {
    return [
      "osascript",
      "-e",
      "on run argv",
      "-e",
      "display notification (item 2 of argv) with title (item 1 of argv)",
      "-e",
      "end run",
      "--",
      title,
      body,
    ];
  }

  if (platform === "linux") {
    return ["notify-send", "--", title, body];
  }

  return undefined;
}

/**
 * A notifier that runs the platform's tool. It starts the command and moves
 * on; a command still running after `timeoutMs` is killed, and one that
 * fails or can't start is reported once through `onFailure` and otherwise
 * ignored. `which` finds the tool up front: without it the notifier is
 * `unavailable`.
 */
export function createDesktopNotifier({
  platform = process.platform,
  which = Bun.which,
  spawn = (command) =>
    Bun.spawn(command, { stdin: "ignore", stdout: "ignore", stderr: "ignore" }),
  timeoutMs = notificationTimeoutMs,
  onFailure = () => {},
}: {
  platform?: string;
  which?: (tool: string) => string | null;
  spawn?: (command: string[]) => NotifierProcess;
  timeoutMs?: number;
  onFailure?: (note: string) => void;
} = {}): DesktopNotifier {
  const probe = notificationCommand(platform, "", "");

  if (!probe) {
    return {
      show: () => {},
      unavailable: `desktop notifications aren't supported on ${platform}: the bell only`,
    };
  }

  if (!which(probe[0]!)) {
    return {
      show: () => {},
      unavailable: `desktop notifications need ${probe[0]}, which wasn't found: the bell only`,
    };
  }

  let reported = false;
  const fail = (reason: string) => {
    if (reported) {
      return;
    }

    reported = true;
    onFailure(`desktop notification failed (${reason}); the bell still rings`);
  };

  return {
    show(title, body) {
      const command = notificationCommand(platform, title, body)!;

      try {
        const child = spawn(command);
        const timer = setTimeout(() => {
          fail("timed out");
          child.kill();
        }, timeoutMs);

        child.exited.then(
          (code) => {
            clearTimeout(timer);

            if (code !== 0) {
              fail(`${command[0]} exited with ${code}`);
            }
          },
          () => clearTimeout(timer),
        );
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error));
      }
    },
  };
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
