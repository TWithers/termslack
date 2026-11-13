import type {
  ContentBlock,
  ContentField,
  StyledSegment,
} from "../../session/content";
import { emojify } from "../../session/emoji";
import type { Message, Reaction } from "../../session/events";
import { renderMessageBody } from "../../session/messageText";
import type { WorkspaceSession } from "../../session/workspaceSession";
import { authorColour, legibleColour } from "../authorColour";
import { theme } from "../theme";
import { cellWidth } from "../terminalSafeText";
import {
  fileList,
  messageAuthor,
  noText,
  segmentStyle,
} from "../messageFormat";
import type { HistoryStatus } from "./useHistory";
import { type Run, wrapPreformatted, wrapRuns } from "./wrap";

/**
 * One terminal line of the message pane. The pane scrolls over a flat list of
 * these, so anything that takes a line (a message line, a notice, and later
 * author headers, day separators or reactions) is just another kind of row.
 * `key` is unique within the list and stays the same for the same line while
 * rows come and go around it, which is what lets the view keep its place.
 */
export type PaneRow = {
  key: string;
  kind:
    | "message"
    | "authorHeader"
    | "daySeparator"
    | "reactions"
    | "replyCount"
    | "notice";
  /**
   * The `ts` of the message this row belongs to: its lines, reactions and
   * reply count. Only messages can be selected, so rows without one (day
   * separators, author lines, notices) are never part of a selection.
   */
  messageTs?: string;
  runs: Run[];
};

/**
 * How long a pause (since the author's previous message) still counts as the
 * same breath. Five minutes keeps a burst of messages together, while a
 * reply after a real break gets its author line again so the reader can see
 * who is speaking without scrolling. Measured from the previous message, not
 * the group's first, so a steady back-and-forth stays one group.
 */
export const groupWindowMs = 5 * 60 * 1000;

/** Deleted messages and Slack's placeholders for them are never drawn. */
export function isShown(message: Message): boolean {
  return !message.isDeleted && message.subtype !== "tombstone";
}

export function clock(ts: string): string {
  return new Date(Number.parseFloat(ts) * 1000).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** `you` is the viewer, whose mentions stand out. `compact` leaves out the address after a link's label, for tight places like field grids. */
export function inlineRuns(
  segments: StyledSegment[],
  you: string | undefined,
  compact = false,
): Run[] {
  return segments.flatMap((segment): Run[] => {
    const { text, trailing, ...style } = segmentStyle(segment, you);

    return [
      { text, ...style },
      ...(trailing && !compact
        ? [{ text: ` ${trailing}`, color: theme.linkAddressText }]
        : []),
    ];
  });
}

const indent = "  ";
const clockWidth = 5;
const bodyIndent = indent.length + clockWidth + 1;

const quotePrefix = (): Run => ({ text: "▎ ", color: theme.quoteBar });
const codeIndent = "  ";
const bullets = ["•", "◦", "▪"];

const spaces = (count: number): Run => ({ text: " ".repeat(count) });

const barCharacter = "▌ ";
const namedBarColors = (): Record<string, string> => ({
  good: theme.attachmentGoodBar,
  warning: theme.attachmentWarningBar,
  danger: theme.attachmentDangerBar,
});

/** The colour of an attachment's bar: a theme colour for Slack's named ones, the `#rrggbb` Slack gave made legible on the pane, else the default. */
function barColor(color?: string): string {
  if (color === undefined) {
    return theme.attachmentBar;
  }

  if (/^#[0-9a-f]{6}$/i.test(color)) {
    return legibleColour(color.toLowerCase());
  }

  return namedBarColors()[color] ?? theme.attachmentBar;
}
const dividerWidth = 30;
const columnGap = 2;
const minColumnWidth = 20;

const widthOfLine = (line: Run[]) =>
  line.reduce((total, run) => total + cellWidth(run.text), 0);

/** Fields in two columns when both fit at least `minColumnWidth` cells, else stacked; wide fields always take the full width. */
function fieldLines(
  fields: ContentField<StyledSegment>[],
  width: number,
  you: string | undefined,
): Run[][] {
  const cellLines = (field: ContentField<StyledSegment>, cellWidth: number) =>
    field.blocks.flatMap((block) =>
      blockLines(block, cellWidth, [], you, true),
    );
  const hasTwoColumns = width >= 2 * minColumnWidth + columnGap;
  const columnWidth = Math.floor((width - columnGap) / 2);
  const lines: Run[][] = [];

  for (let index = 0; index < fields.length; index++) {
    const field = fields[index]!;
    const next = fields[index + 1];

    if (!hasTwoColumns || field.wide) {
      lines.push(...cellLines(field, width));
      continue;
    }

    if (!next || next.wide) {
      lines.push(...cellLines(field, columnWidth));
      continue;
    }

    const left = cellLines(field, columnWidth);
    const right = cellLines(next, columnWidth);

    for (let row = 0; row < Math.max(left.length, right.length); row++) {
      const leftLine = left[row] ?? [];
      const rightLine = right[row];

      lines.push(
        rightLine
          ? [
              ...leftLine,
              spaces(columnWidth - widthOfLine(leftLine) + columnGap),
              ...rightLine,
            ]
          : leftLine,
      );
    }

    index++;
  }

  return lines;
}

/** Lays `lines` out after `first`, with `rest` in front of the continuation lines. */
function prefixed(lines: Run[][], first: Run, rest: Run): Run[][] {
  return lines.map((line, index) => [index === 0 ? first : rest, ...line]);
}

/** The terminal lines of one block within `width` cells (before the body indent). */
function blockLines(
  block: ContentBlock<StyledSegment>,
  width: number,
  suffix: Run[],
  you: string | undefined,
  compact = false,
): Run[][] {
  switch (block.kind) {
    case "paragraph":
      return wrapRuns(
        [...inlineRuns(block.inline, you, compact), ...suffix],
        width,
      );
    case "header":
    case "actions":
    case "image":
      return wrapRuns(inlineRuns(block.inline, you, compact), width);
    case "context":
      return wrapRuns(
        inlineRuns(block.inline, you, compact).map((run) => ({
          ...run,
          color: theme.blockKitContextText,
        })),
        width,
      );
    case "divider":
      return [
        [
          {
            text: "─".repeat(Math.min(width, dividerWidth)),
            color: theme.blockKitContextText,
          },
        ],
      ];
    case "fields":
      return fieldLines(block.fields, width, you);
    case "attachment": {
      const bar: Run = { text: barCharacter, color: barColor(block.color) };

      return [
        ...block.pretext.flatMap((inner) =>
          blockLines(inner, width, [], you, true),
        ),
        ...block.blocks
          .flatMap((inner) =>
            blockLines(inner, width - barCharacter.length, [], you, true),
          )
          .map((line) => [bar, ...line]),
      ];
    }
    case "quote":
      return wrapRuns(
        [...inlineRuns(block.inline, you, compact), ...suffix],
        width - quotePrefix().text.length,
      ).map((line) => [quotePrefix(), ...line]);
    case "code":
      return wrapPreformatted(
        inlineRuns(block.inline, you).map((run) => ({
          ...run,
          color: theme.codeBlockText,
          backgroundColor: theme.codeBlockBackground,
        })),
        width - codeIndent.length,
      ).map((line) => [spaces(codeIndent.length), ...line]);
    case "list":
      return block.items.flatMap((item, index) => {
        const marker = block.ordered
          ? `${block.start + index}.`
          : bullets[block.indent % bullets.length]!;
        const lead = `${"  ".repeat(block.indent)}${marker} `;
        const isLast = index === block.items.length - 1;

        return prefixed(
          wrapRuns(
            [...inlineRuns(item, you), ...(isLast ? suffix : [])],
            width - lead.length,
          ),
          { text: lead },
          spaces(lead.length),
        );
      });
  }
}

/**
 * The lines of a message's body: its blocks laid out in order, then its file
 * names and "(edited)" after the last paragraph (or on their own line).
 */
export function bodyLines(
  message: Message,
  session: WorkspaceSession,
  width: number,
): Run[][] {
  const files = fileList(message);
  const shown = renderMessageBody(message, session);
  const blocks: ContentBlock<StyledSegment>[] =
    shown.length === 0 && !files
      ? [{ kind: "paragraph", inline: [{ kind: "text", text: noText }] }]
      : shown;
  const trailing: Run[] = [
    ...(files ? [{ text: files, color: theme.fileText }] : []),
    ...(message.isEdited
      ? [{ text: "(edited)", color: theme.editedText }]
      : []),
    ...(message.delivery === "failed"
      ? [{ text: "(not sent)", color: theme.notSentText }]
      : []),
  ].flatMap((run, index): Run[] => (index > 0 ? [{ text: " " }, run] : [run]));
  const last = blocks.at(-1);
  const attachesToLast =
    last !== undefined &&
    (last.kind === "paragraph" ||
      last.kind === "quote" ||
      last.kind === "list");
  const lines = blocks.flatMap((block, index) =>
    blockLines(
      block,
      width,
      attachesToLast && index === blocks.length - 1 && trailing.length > 0
        ? [{ text: " " }, ...trailing]
        : [],
      session.currentUserId,
    ),
  );

  return attachesToLast || trailing.length === 0
    ? lines
    : [...lines, ...wrapRuns(trailing, width)];
}

function sentAt(message: Message): Date {
  return new Date(Number.parseFloat(message.ts) * 1000);
}

/** `2026-11-04` in the local time zone: one value per calendar day. */
export function dayKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** "Today", "Yesterday", else "Monday, Nov 3", with the year when it isn't this one. */
export function dayLabel(date: Date, now: Date): string {
  if (dayKey(date) === dayKey(now)) {
    return "Today";
  }

  const yesterday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - 1,
  );

  if (dayKey(date) === dayKey(yesterday)) {
    return "Yesterday";
  }

  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

/** Who wrote a message, as far as grouping goes: the same person, or the same bot under the same name. */
function authorKey(message: Message): string {
  return [message.userId, message.botId, message.botName].join("|");
}

function startsGroup(previous: Message | undefined, message: Message): boolean {
  if (!previous) {
    return true;
  }

  return (
    authorKey(previous) !== authorKey(message) ||
    dayKey(sentAt(previous)) !== dayKey(sentAt(message)) ||
    sentAt(message).getTime() - sentAt(previous).getTime() > groupWindowMs
  );
}

/**
 * `👍 3  🎉 1`: each reaction as its emoji (`:shortcode:` for custom ones) and
 * count, in the order they first appeared. The user's own have their own colours. The
 * space inside an item is a no-break space so a wrap never splits an item.
 */
function reactionRuns(reactions: Reaction[], session: WorkspaceSession): Run[] {
  return reactions.flatMap((reaction, index): Run[] => {
    const isOwn =
      session.currentUserId !== undefined &&
      reaction.userIds.includes(session.currentUserId);

    return [
      ...(index > 0 ? [{ text: "  " }] : []),
      {
        text: `${emojify(`:${reaction.name}:`, session)}\u00a0${reaction.count}`,
        color: isOwn ? theme.ownReactionText : theme.reactionText,
        backgroundColor: isOwn
          ? theme.ownReactionBackground
          : theme.reactionBackground,
      },
    ];
  });
}

function replyCountText(count: number): string {
  return `${count} ${count === 1 ? "reply" : "replies"}`;
}

/**
 * The lines of `messages` (oldest first) when wrapped to `width` cells: a day
 * separator where the day changes, an author line where a new group starts,
 * then each message indented under it with its time, its reactions, and a
 * reply count under thread parents. Grouping looks at neighbours in this one list, so it is the
 * same whatever pages the messages came from. `now` decides "Today".
 */
export function messageRows(
  messages: Message[],
  session: WorkspaceSession,
  width: number,
  now: Date = new Date(),
): PaneRow[] {
  return messages.flatMap((message, index) => {
    const previous = messages[index - 1];
    const rows: PaneRow[] = [];
    const day = dayKey(sentAt(message));

    if (!previous || dayKey(sentAt(previous)) !== day) {
      rows.push({
        key: `day:${day}`,
        kind: "daySeparator",
        runs: [
          {
            text: `── ${dayLabel(sentAt(message), now)} ──`,
            color: theme.daySeparatorText,
          },
        ],
      });
    }

    if (startsGroup(previous, message)) {
      rows.push({
        key: `hdr:${message.ts}`,
        kind: "authorHeader",
        runs: [
          {
            text: messageAuthor(message, session),
            bold: true,
            color: authorColour(message, session),
          },
        ],
      });
    }

    const isPending = message.delivery === "pending";

    bodyLines(message, session, width - bodyIndent).forEach((runs, line) =>
      rows.push({
        key: `${message.ts}:${line}`,
        kind: "message",
        messageTs: message.ts,
        runs: (line === 0
          ? [
              { text: indent },
              { text: clock(message.ts), color: theme.timestampText },
              { text: " " },
              ...runs,
            ]
          : [spaces(bodyIndent), ...runs]
        ).map((run) =>
          isPending ? { ...run, color: theme.pendingMessageText } : run,
        ),
      }),
    );

    if (message.reactions?.length) {
      wrapRuns(
        reactionRuns(message.reactions, session),
        width - bodyIndent,
      ).forEach((runs, line) =>
        rows.push({
          key: `react:${message.ts}${line === 0 ? "" : `:${line}`}`,
          kind: "reactions",
          messageTs: message.ts,
          runs: [{ text: " ".repeat(bodyIndent) }, ...runs],
        }),
      );
    }

    if (message.replyCount) {
      rows.push({
        key: `replies:${message.ts}`,
        kind: "replyCount",
        messageTs: message.ts,
        runs: [
          { text: " ".repeat(bodyIndent) },
          {
            text: `↳ ${replyCountText(message.replyCount)}`,
            color: theme.replyCountText,
          },
        ],
      });
    }

    return rows;
  });
}

/** A line of status text, like "Loading older messages…". */
export function noticeRow(key: string, text: string, color?: string): PaneRow {
  return {
    key: `notice:${key}`,
    kind: "notice",
    runs: [{ text, color: color ?? theme.secondaryText }],
  };
}

/**
 * What to say about fetching older pages. Shown beside the title rather than
 * as a row, because the rows it would belong to are above the view.
 */
export function olderStatusText(
  history?: HistoryStatus,
): { text: string; color?: string } | undefined {
  if (history?.kind !== "loaded") {
    return undefined;
  }

  if (history.older.kind === "loading") {
    return { text: "Loading older messages…" };
  }

  if (history.older.kind === "failed") {
    return {
      text: `Couldn't load older messages: ${history.older.message}`,
      color: theme.error,
    };
  }

  return undefined;
}

/** Everything the pane scrolls over for a conversation, and the `ts` of its newest shown message. */
export type ConversationRows = { rows: PaneRow[]; newestTs?: string };

/**
 * The pane's rows, oldest first: status notices at the top (loading, failed,
 * empty, beginning of the conversation), then the shown messages wrapped to
 * `width` cells.
 */
export function conversationRows(
  session: WorkspaceSession,
  conversationId: string,
  width: number,
  history?: HistoryStatus,
  now: Date = new Date(),
): ConversationRows {
  const messages = session.messages(conversationId).filter(isShown);
  const notices: PaneRow[] = [];

  if (history?.kind === "loading") {
    notices.push(noticeRow("loading", "Loading messages…"));
  }

  if (history?.kind === "failed") {
    notices.push(
      noticeRow(
        "failed",
        `Couldn't load messages: ${history.message}`,
        theme.error,
      ),
    );
  }

  if (history?.kind === "loaded") {
    if (messages.length === 0) {
      notices.push(noticeRow("empty", "No messages yet"));
    } else if (!history.hasMore) {
      notices.push(noticeRow("beginning", "Beginning of conversation"));
    }
  }

  return {
    rows: [...notices, ...messageRows(messages, session, width, now)],
    newestTs: messages.at(-1)?.ts,
  };
}

/** The state of loading a thread's replies. */
export type ThreadStatus =
  | { kind: "loading" }
  | { kind: "loaded" }
  | { kind: "failed"; message: string };

/**
 * The thread pane's rows, oldest first: the parent, then its replies, built
 * by the same `messageRows` as the conversation so the two look alike. The
 * parent's reply-count line is left off (the replies are right below it), and
 * status notices (loading, failed, no replies) come last, where the replies
 * would be. Replies are loaded in full when the thread opens, so there is no
 * "older" to fetch.
 */
export function threadRows(
  session: WorkspaceSession,
  conversationId: string,
  threadTs: string,
  width: number,
  status: ThreadStatus,
  now: Date = new Date(),
): ConversationRows {
  const parent = session.message(conversationId, threadTs);
  const replies = session
    .threadReplies(conversationId, threadTs)
    .filter(isShown);
  const messages = [
    ...(parent && isShown(parent)
      ? [{ ...parent, replyCount: undefined }]
      : []),
    ...replies,
  ];
  const notices: PaneRow[] = [];

  if (status.kind === "loading") {
    notices.push(noticeRow("thread-loading", "Loading replies…"));
  }

  if (status.kind === "failed") {
    notices.push(
      noticeRow(
        "thread-failed",
        `Couldn't load replies: ${status.message}`,
        theme.error,
      ),
    );
  }

  if (status.kind === "loaded" && replies.length === 0) {
    notices.push(noticeRow("thread-empty", "No replies yet"));
  }

  return {
    rows: [...messageRows(messages, session, width, now), ...notices],
    newestTs: messages.at(-1)?.ts,
  };
}
