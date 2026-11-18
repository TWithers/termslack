import type { ChannelDetails as Details } from "../../slack/convert";
import type { NotificationLevel } from "../../session/notificationLevels";
import { renderMessageText } from "../../session/messageText";
import { personName } from "../../session/people";
import type { WorkspaceSession } from "../../session/workspaceSession";
import { Text } from "../SafeText";
import { cellWidth } from "../terminalSafeText";
import { theme } from "../theme";
import type { OverlayItem } from "./Overlay";
import { inlineRuns } from "./paneRows";
import { RunText } from "./RunsText";
import { type Run, wrapRuns } from "./wrap";

/** What the keys do while the channel details are open; drawn on its bottom border. */
export const channelDetailsKeyHints =
  "j/k scroll · PgUp/PgDn page · g/G top/bottom · Esc close";

/** What the popup shows: Slack's answer is on its way, came, or was refused (with the reason). */
export type ChannelDetailsContent =
  | { status: "loading" }
  | { status: "failed"; message: string }
  | { status: "loaded"; details: Details };

const labelWidth = 13;

type Lookup = Pick<
  WorkspaceSession,
  | "user"
  | "conversation"
  | "conversationMembers"
  | "userGroup"
  | "customEmoji"
  | "customEmojiNames"
  | "currentUserId"
>;

const none = (): Run[] => [{ text: "none", color: theme.secondaryText }];

/** A topic or description as messages show it (mentions, channel links, emoji, links), or "none" when empty. */
function slackText(text: string, session: Lookup): Run[] {
  return text.trim() === ""
    ? none()
    : inlineRuns(renderMessageText(text, session), session.currentUserId);
}

function createdText(
  { creatorId, created }: Details,
  session: Lookup,
): Run[] | undefined {
  const by = creatorId
    ? `by ${personName(session.user(creatorId), creatorId)}`
    : undefined;
  const on = created
    ? new Date(created * 1000).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : undefined;
  const text = [on, by].filter(Boolean).join(" ");

  return text === "" ? undefined : [{ text }];
}

const notificationLevelText: Record<NotificationLevel, string> = {
  mentions: "Mentions only",
  all: "All messages",
  off: "Off",
};

/**
 * The popup's lines for a list `width` columns wide: one item per screen
 * line, so it scrolls and counts in lines. Each field is its label then its
 * value, which wraps under itself, aligned with the value column. `section`
 * is the name of the sidebar section the channel is in, if known; `muted`
 * whether it is muted in termslack, and `notificationLevel` what it notifies for.
 */
export function channelDetailsItems(
  content: ChannelDetailsContent,
  width: number,
  session: Lookup,
  section: string | undefined,
  muted: boolean,
  notificationLevel: NotificationLevel,
): OverlayItem[] {
  function lines(
    id: string,
    label: string,
    value: Run[],
    labelColor: string = theme.secondaryText,
  ): OverlayItem[] {
    const indent = label === "" ? 0 : labelWidth;

    return wrapRuns(value, Math.max(1, width - indent)).map((line, index) => ({
      key: `${id}:${index}`,
      node: (
        <Text wrap="truncate" color={theme.text}>
          <Text color={labelColor}>
            {index === 0
              ? `${label}${" ".repeat(indent - cellWidth(label))}`
              : " ".repeat(indent)}
          </Text>
          {line.map((run, at) => (
            <RunText key={at} run={run} />
          ))}
        </Text>
      ),
    }));
  }

  if (content.status === "loading") {
    return lines("loading", "", [
      { text: "Loading…", color: theme.secondaryText },
    ]);
  }

  if (content.status === "failed") {
    return lines("failed", "", [{ text: content.message, color: theme.error }]);
  }

  const { details } = content;
  const created = createdText(details, session);

  return [
    ...lines("name", "Name", [{ text: `#${details.name ?? details.id}` }]),
    ...lines("type", "Type", [
      { text: details.isPrivate ? "Private channel" : "Public channel" },
    ]),
    ...lines("topic", "Topic", slackText(details.topic, session)),
    ...lines(
      "description",
      "Description",
      slackText(details.description, session),
    ),
    ...(created ? lines("created", "Created", created) : []),
    ...(details.memberCount === undefined
      ? []
      : lines("members", "Members", [{ text: String(details.memberCount) }])),
    ...lines("id", "ID", [{ text: details.id }]),
    ...(section === undefined
      ? []
      : lines("section", "Section", [{ text: section }])),
    ...lines("muted", "Muted", [{ text: muted ? "yes" : "no" }]),
    ...lines("notify", "Notify", [
      { text: notificationLevelText[notificationLevel] },
    ]),
  ];
}
