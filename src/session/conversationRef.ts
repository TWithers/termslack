import type { Conversation, User } from "./events";
import { personName } from "./people";

/** What a command-line conversation reference can be matched against. */
export type ConversationRefLookup = {
  conversation(id: string): Conversation | undefined;
  conversations(): Conversation[];
  user(id: string): User | undefined;
  users(): User[];
};

export type ConversationRefResult =
  | { status: "found"; conversation: Conversation }
  /** Looks like an ID the store doesn't know; Slack will say whether it exists. */
  | { status: "id"; id: string }
  | {
      status: "notFound";
      /** One sentence saying what wasn't found. */
      message: string;
      /** Names close to what was asked for, as they'd be typed (`#random`, `@egon`). */
      suggestions: string[];
    };

const idPattern = /^[CGDW][A-Z0-9]{8,}$/;
const maxSuggestions = 5;

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);

  for (let i = 1; i <= a.length; i++) {
    const row = [i];

    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        (previous[j] ?? 0) + 1,
        (row[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }

    previous = row;
  }

  return previous[b.length] ?? 0;
}

/** How far a candidate is from the query: 0 for a substring, else the edit distance; undefined when too far. */
function closeness(query: string, candidate: string): number | undefined {
  const text = candidate.toLowerCase();

  if (text.includes(query) || query.includes(text)) {
    return 0;
  }

  const distance = editDistance(query, text);

  return distance <= Math.max(2, Math.floor(query.length / 3))
    ? distance
    : undefined;
}

type Candidate = {
  /** Every name it goes by. */
  names: string[];
  /** How to show it. */
  label: string;
};

function closeMatches(query: string, candidates: Candidate[]): string[] {
  return candidates
    .map((candidate) => ({
      label: candidate.label,
      score: Math.min(
        ...candidate.names.map(
          (name) => closeness(query, name) ?? Number.POSITIVE_INFINITY,
        ),
      ),
    }))
    .filter(({ score }) => Number.isFinite(score))
    .sort((a, b) => a.score - b.score || a.label.localeCompare(b.label))
    .slice(0, maxSuggestions)
    .map(({ label }) => label);
}

function preferred(conversations: Conversation[]): Conversation | undefined {
  return (
    conversations.find((c) => c.isMember && !c.isArchived) ??
    conversations.find((c) => !c.isArchived) ??
    conversations[0]
  );
}

function findDirectMessage(
  query: string,
  lookup: ConversationRefLookup,
): ConversationRefResult {
  const people = lookup.conversations().filter((c) => c.kind === "im");
  const namesOf = (user: User | undefined, id: string) =>
    [user?.displayName, user?.realName, user?.name, id].filter(
      (name): name is string => !!name,
    );
  const candidates = people.map((conversation) => {
    const id = conversation.userId ?? "";
    const user = lookup.user(id);

    return {
      conversation,
      names: namesOf(user, id),
      label: `@${user?.name || personName(user, id)}`,
    };
  });
  const exact = candidates.find(({ names }) =>
    names.some((name) => name.toLowerCase() === query),
  );

  if (exact) {
    return { status: "found", conversation: exact.conversation };
  }

  const known = lookup
    .users()
    .find((user) =>
      namesOf(user, user.id).some((name) => name.toLowerCase() === query),
    );

  return {
    status: "notFound",
    message: known
      ? `You have no direct message with ${personName(known, known.id)} yet, and termslack can't start one.`
      : `No person named "${query}" found among your direct messages.`,
    suggestions: closeMatches(query, candidates),
  };
}

/**
 * Finds the conversation a person typed: `general` or `#general`, `@name` for
 * a direct message with that person, or a raw ID. Only conversations the
 * store knows (the ones the user is in) can be found by name.
 */
export function findConversationByRef(
  reference: string,
  lookup: ConversationRefLookup,
): ConversationRefResult {
  const trimmed = reference.trim();

  if (trimmed.startsWith("@")) {
    return findDirectMessage(trimmed.slice(1).toLowerCase(), lookup);
  }

  const bare = trimmed.replace(/^#/, "");
  const query = bare.toLowerCase();

  if (idPattern.test(bare)) {
    const known = lookup.conversation(bare);

    return known
      ? { status: "found", conversation: known }
      : { status: "id", id: bare };
  }

  const channels = lookup
    .conversations()
    .filter((c) => c.kind === "channel" || c.kind === "group");
  const exact = preferred(
    channels.filter((c) => c.name?.toLowerCase() === query),
  );

  if (exact) {
    return { status: "found", conversation: exact };
  }

  return {
    status: "notFound",
    message: `No channel named "${bare}" found among the conversations you're in.`,
    suggestions: closeMatches(
      query,
      channels.flatMap((c) =>
        c.name ? [{ names: [c.name], label: `#${c.name}` }] : [],
      ),
    ),
  };
}
