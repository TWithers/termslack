import {
  type Conversation,
  type ConversationKind,
  isDirectMessage,
  type User,
} from "./events";

/** The name a person goes by: display name, else real name, else username, else their ID. */
export function personName(user: User | undefined, id: string): string {
  return (
    [user?.displayName, user?.realName, user?.name].find(
      (name) => name !== undefined && name !== "",
    ) ??
    (id || "?")
  );
}

/**
 * Who a DM or group DM is with, by name: the other person for a DM, the
 * other members for a group DM. Undefined when that isn't known yet.
 */
export function directConversationLabel(
  conversation: Conversation,
  lookup: {
    user(id: string): User | undefined;
    conversationMembers(id: string): string[] | undefined;
    currentUserId?: string;
  },
): string | undefined {
  if (conversation.kind === "im") {
    return conversation.userId
      ? personName(lookup.user(conversation.userId), conversation.userId)
      : undefined;
  }

  const memberIds = lookup.conversationMembers(conversation.id);

  if (!memberIds) {
    return undefined;
  }

  const others = memberIds.filter((id) => id !== lookup.currentUserId);

  return (others.length > 0 ? others : memberIds)
    .map((id) => personName(lookup.user(id), id))
    .join(", ");
}

/** What a conversation is called: the channel's name, or who a DM or group DM is with. Undefined when unknown. */
export function conversationLabel(
  conversation: Conversation,
  lookup: Parameters<typeof directConversationLabel>[1],
): string | undefined {
  if (isDirectMessage(conversation.kind)) {
    return directConversationLabel(conversation, lookup);
  }

  return conversation.name || undefined;
}

const titlePrefixes: Record<ConversationKind, string> = {
  channel: "#",
  group: "#",
  im: "@",
  mpim: "@",
};

/** A conversation's name as the UI shows it: `#general` for a channel, `@sarah` for a DM. */
export function conversationTitle(
  kind: ConversationKind,
  label: string,
): string {
  return `${titlePrefixes[kind]}${label}`;
}
