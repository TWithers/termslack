import type { User } from "../../session/events";
import { conversationTitle, personName } from "../../session/people";
import type { ConversationMarkers } from "../../session/unreadTracker";
import type { WorkspaceSession } from "../../session/workspaceSession";
import { sidebarEntry } from "./sidebarEntries";
import type { SwitcherCandidate } from "./switcherRanking";

const noMarkers: ConversationMarkers = { isUnread: false, mentions: 0 };

/** The names a person goes by (display name, real name, username), each once ignoring case, without the empty ones. */
function namesOf(user: User | undefined, ...first: string[]): string[] {
  const seen = new Set<string>();

  return [...first, user?.displayName, user?.realName, user?.name].filter(
    (name): name is string => {
      if (!name || seen.has(name.toLowerCase())) {
        return false;
      }

      seen.add(name.toLowerCase());

      return true;
    },
  );
}

function notMemberNote(memberCount: number | undefined): string {
  if (memberCount === undefined) {
    return "not a member";
  }

  return `not a member · ${memberCount} ${memberCount === 1 ? "member" : "members"}`;
}

/**
 * Everything the quick switcher can open: every conversation the user is in
 * (archived ones left out), the public channels they aren't in (once listed),
 * and every person without a DM yet, by name.
 * Unlike the sidebar this includes the DMs its recent-DMs filter hides.
 * Deleted users and bots aren't listed; the current user is. A person with a
 * DM shows only as the DM, which also matches their real name and username.
 */
export function switcherCandidates(
  session: Pick<
    WorkspaceSession,
    | "conversations"
    | "user"
    | "users"
    | "conversationMembers"
    | "currentUserId"
    | "markers"
  > &
    Partial<Pick<WorkspaceSession, "isMuted">>,
): SwitcherCandidate[] {
  const conversations = session
    .conversations()
    .filter(({ isMember, isArchived }) => isMember && !isArchived);
  const withDm = new Set(
    conversations.flatMap(({ kind, userId }) =>
      kind === "im" && userId ? [userId] : [],
    ),
  );
  const found: SwitcherCandidate[] = conversations.map((conversation) => {
    const { label, markers, muted } = sidebarEntry(conversation, session);
    const person = conversation.userId
      ? session.user(conversation.userId)
      : undefined;

    return {
      id: conversation.id,
      label,
      names: namesOf(person, label.slice(1)),
      markers,
      note:
        [
          conversation.kind === "group" ? "private" : undefined,
          muted ? "muted" : undefined,
        ]
          .filter((note) => note !== undefined)
          .join(" · ") || undefined,
      muted,
    };
  });

  for (const {
    id,
    kind,
    name,
    isMember,
    isArchived,
    memberCount,
  } of session.conversations()) {
    if (kind !== "channel" || isMember || isArchived || !name) {
      continue;
    }

    found.push({
      id,
      label: conversationTitle(kind, name),
      names: [name],
      markers: noMarkers,
      note: notMemberNote(memberCount),
      notMember: true,
    });
  }

  for (const user of session.users()) {
    if (user.isBot || user.isDeleted || withDm.has(user.id)) {
      continue;
    }

    const name = personName(user, user.id);
    const names = namesOf(user, name);
    const alongside = names.filter((other) => other !== name);

    found.push({
      id: `user:${user.id}`,
      userId: user.id,
      label: `@${name}`,
      names,
      markers: noMarkers,
      note: alongside.length > 0 ? alongside.join(" · ") : undefined,
    });
  }

  return found;
}
