import type { Conversation, User, UserGroup } from "./events";

/** Everything a mention can point at, as the store knows it right now. */
export type MentionDirectory = {
  users: User[];
  userGroups: UserGroup[];
  conversations: Conversation[];
};

/**
 * A mention the user picked from the completion list (or that came back from
 * `fromSlackText`): the text shown in the input and the Slack syntax it
 * stands for. Keeping the Slack form, not just a name, is what lets a picked
 * mention survive two people sharing a name.
 */
export type Mention = {
  /** What is in the input text, with its `@` or `#`. */
  label: string;
  /** What Slack gets, e.g. `<@U123>`. */
  slack: string;
};

/** One line of the completion list. */
export type CompletionEntry = Mention & {
  /** Who or what it is, when the label alone doesn't say (a real name). */
  detail?: string;
};

export const maxCompletions = 6;

const broadcasts = ["here", "channel", "everyone"];

/** Characters a handle is made of; anything else ends a mention. */
const handleCharacters = String.raw`\p{L}\p{N}_`;
const handlePattern = String.raw`[${handleCharacters}]+(?:[.\-][${handleCharacters}]+)*`;

/** What you'd type for a name: no spaces or other characters a mention can't hold. */
function handleOf(name: string | undefined): string | undefined {
  const handle = (name ?? "").replace(/[^\p{L}\p{N}_.\-]/gu, "");

  return new RegExp(`^${handlePattern}$`, "u").test(handle)
    ? handle
    : undefined;
}

/** The handles a person answers to: display name, username, real name. */
function userHandles(user: User): string[] {
  return [user.displayName, user.name, user.realName].flatMap((name) => {
    const handle = handleOf(name);

    return handle === undefined ? [] : [handle];
  });
}

const sameHandle = (a: string, b: string) =>
  a.toLowerCase() === b.toLowerCase();

function isPerson(user: User): boolean {
  return !user.isDeleted;
}

function isChannel(conversation: Conversation): boolean {
  return (
    (conversation.kind === "channel" || conversation.kind === "group") &&
    !!conversation.name
  );
}

/** Everything a typed `@handle` could mean, as Slack text. */
function userTargets(directory: MentionDirectory, handle: string): string[] {
  const targets = new Set<string>();

  for (const user of directory.users.filter(isPerson)) {
    if (userHandles(user).some((own) => sameHandle(own, handle))) {
      targets.add(`<@${user.id}>`);
    }
  }

  for (const group of directory.userGroups) {
    if (sameHandle(handleOf(group.handle) ?? "", handle)) {
      targets.add(`<!subteam^${group.id}>`);
    }
  }

  return [...targets];
}

function resolveUser(
  directory: MentionDirectory,
  handle: string,
): string | undefined {
  const lower = handle.toLowerCase();

  if (broadcasts.includes(lower)) {
    return `<!${lower}>`;
  }

  const targets = userTargets(directory, handle);

  return targets.length === 1 ? targets[0] : undefined;
}

function resolveChannel(
  directory: MentionDirectory,
  name: string,
): string | undefined {
  const matches = directory.conversations.filter(
    (conversation) =>
      isChannel(conversation) &&
      conversation.name!.toLowerCase() === name.toLowerCase(),
  );
  const live = matches.filter((conversation) => !conversation.isArchived);
  const candidates = live.length > 0 ? live : matches;

  return candidates.length === 1 ? `<#${candidates[0]!.id}>` : undefined;
}

const escapeText = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A mention starts at `@` or `#` that isn't glued to a word, so `ada@tim.com` is left alone. */
const mentionPattern = new RegExp(
  String.raw`(?<![${handleCharacters}.\-+])([@#])(${handlePattern})`,
  "gu",
);

/** Fenced blocks and inline code, where nothing is converted. */
const codePattern = /```[\s\S]*?```|`[^`\n]*`/g;

/**
 * What the user typed, as Slack's message text. The one place typed text
 * becomes Slack text:
 *
 * - `&`, `<` and `>` are escaped so Slack shows them as typed.
 * - A mention the user picked (`picked`, in the order they were picked) maps
 *   to exactly what was picked: the n-th `@sam` in the text is the n-th
 *   picked `@sam`, however many people share the name.
 * - Any other `@handle` or `#channel` converts only when exactly one person,
 *   user group or channel has that handle; `@here`, `@channel` and
 *   `@everyone` always do. Unknown and ambiguous names stay plain text.
 * - Email addresses and code (backticks) are never converted.
 *
 * Without a `directory`, only escaping happens.
 */
export function toSlackText(
  typed: string,
  directory?: MentionDirectory,
  picked: Mention[] = [],
): string {
  if (directory === undefined) {
    return escapeText(typed);
  }

  const known = directory;

  const used = new Map<string, number>();

  function convert(text: string): string {
    let result = "";
    let position = 0;

    for (const match of text.matchAll(mentionPattern)) {
      const [whole, sigil, handle] = match as unknown as [
        string,
        string,
        string,
      ];
      const nth = used.get(whole) ?? 0;

      used.set(whole, nth + 1);

      const slack =
        picked.filter((mention) => mention.label === whole)[nth]?.slack ??
        (sigil === "@"
          ? resolveUser(known, handle)
          : resolveChannel(known, handle));

      result += escapeText(text.slice(position, match.index));
      result += slack ?? escapeText(whole);
      position = match.index + whole.length;
    }

    return result + escapeText(text.slice(position));
  }

  let result = "";
  let position = 0;

  for (const code of typed.matchAll(codePattern)) {
    result += convert(typed.slice(position, code.index));
    result += escapeText(code[0]);
    position = code.index + code[0].length;
  }

  return result + convert(typed.slice(position));
}

/**
 * Remembers a freshly picked mention, first forgetting picks whose text has
 * since been deleted from `text` (the draft as it was before the pick), so
 * "the n-th label is the n-th pick" stays true.
 */
export function addMention(
  text: string,
  picks: Mention[],
  pick: Mention,
): Mention[] {
  const stillThere =
    text.split(pick.label).length -
    1 -
    // A label that is the start of a longer handle isn't an occurrence.
    [...text.matchAll(mentionPattern)].filter(
      ([whole]) => whole.startsWith(pick.label) && whole !== pick.label,
    ).length;
  const sameLabel = picks.filter((mention) => mention.label === pick.label);
  const kept = new Set(sameLabel.slice(0, Math.max(0, stillThere)));

  return [
    ...picks.filter(
      (mention) => mention.label !== pick.label || kept.has(mention),
    ),
    pick,
  ];
}

const unescapeText = (text: string) =>
  text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** The handle to show for a user: the first of their handles nobody else answers to, else their first. */
function uniqueHandle(
  directory: MentionDirectory,
  user: User,
): string | undefined {
  const handles = userHandles(user);

  return (
    handles.find(
      (handle) =>
        handle.toLowerCase() !== "here" &&
        userTargets(directory, handle).length === 1,
    ) ?? handles[0]
  );
}

/**
 * Slack message text, as editable text: the reverse of `toSlackText`, for
 * editing a sent message. People, user groups and channels become `@name`
 * and `#channel`; `<url|label>` becomes the URL; entities are unescaped. The
 * `mentions` it returns keep every mention's ID, so sending the edit again
 * gives the same mentions even for names that are unknown or ambiguous.
 */
export function fromSlackText(
  slackText: string,
  directory: MentionDirectory,
): { text: string; mentions: Mention[] } {
  const mentions: Mention[] = [];

  const text = slackText.replace(
    /<([^<>]+)>|([^<]+)/g,
    (_, inner: string | undefined, plain: string | undefined) => {
      if (inner === undefined) {
        return unescapeText(plain ?? "");
      }

      const bar = inner.indexOf("|");
      const head = bar === -1 ? inner : inner.slice(0, bar);
      const label = bar === -1 ? undefined : inner.slice(bar + 1);
      const mention = (value: string, slack: string) => {
        mentions.push({ label: value, slack });

        return value;
      };

      if (/^@[A-Z0-9]+$/.test(head)) {
        const id = head.slice(1);
        const person = directory.users.find((user) => user.id === id);
        const handle =
          (person && uniqueHandle(directory, person)) ??
          handleOf(label?.replace(/^@/, "")) ??
          id;

        return mention(`@${handle}`, `<@${id}>`);
      }

      if (/^#[A-Z0-9]+$/.test(head)) {
        const id = head.slice(1);
        const known = directory.conversations.find((c) => c.id === id);
        const name = handleOf(known?.name ?? label) ?? id;

        return mention(`#${name}`, `<#${id}>`);
      }

      if (head.startsWith("!")) {
        const command = head.slice(1);
        const group = /^subteam\^([A-Z0-9]+)$/.exec(command);

        if (broadcasts.includes(command)) {
          return mention(`@${command}`, `<!${command}>`);
        }

        if (group) {
          const known = directory.userGroups.find((g) => g.id === group[1]);
          const handle =
            handleOf(known?.handle ?? label?.replace(/^@/, "")) ?? group[1]!;

          return mention(`@${handle}`, `<!subteam^${group[1]}>`);
        }

        return label === undefined ? "" : unescapeText(label);
      }

      return unescapeText(head);
    },
  );

  return { text, mentions };
}

const kindOrder = { user: 0, group: 1, broadcast: 2 } as const;

type Scored = CompletionEntry & {
  score: number;
  kind: keyof typeof kindOrder;
  sort: string;
};

/** 0 for a handle starting with the query, 1 for a word of a name, 2 for a substring, else undefined. */
function matchScore(
  query: string,
  handles: string[],
  names: string[],
): number | undefined {
  const lower = query.toLowerCase();

  if (lower === "") {
    return 0;
  }

  if (handles.some((handle) => handle.toLowerCase().startsWith(lower))) {
    return 0;
  }

  if (
    names.some((name) =>
      name
        .toLowerCase()
        .split(/[\s._-]+/)
        .some((word) => word.startsWith(lower)),
    )
  ) {
    return 1;
  }

  return handles.some((handle) => handle.toLowerCase().includes(lower))
    ? 2
    : undefined;
}

/**
 * The completion list for what follows an `@` or `#`: at most
 * `maxCompletions` entries. For `@`: people (not deleted users), user groups
 * and `@here`/`@channel`/`@everyone`, those whose handle starts with the query
 * first, then those with a name word starting with it, then the rest that
 * contain it. For `#`: channels, ones the user is in before the others, and
 * archived last. With nothing typed yet, the broadcasts lead.
 *
 * A person's label is the first handle nobody else has, so completing one of
 * two people called Sam gives `@sam.a`; when none is unique the label is
 * ambiguous but the entry's `slack` still names the one that was picked.
 */
export function completionEntries(
  directory: MentionDirectory,
  sigil: "@" | "#",
  query: string,
): CompletionEntry[] {
  const scored: Scored[] = [];

  if (sigil === "#") {
    for (const conversation of directory.conversations.filter(isChannel)) {
      const name = conversation.name!;
      const score = matchScore(query, [name], [name]);

      if (score !== undefined) {
        scored.push({
          label: `#${name}`,
          slack: `<#${conversation.id}>`,
          score:
            score +
            (conversation.isArchived ? 20 : conversation.isMember ? 0 : 10),
          kind: "user",
          sort: name.toLowerCase(),
        });
      }
    }
  } else {
    for (const user of directory.users.filter(isPerson)) {
      const handles = userHandles(user);
      const score = matchScore(query, handles, [
        user.displayName ?? "",
        user.realName ?? "",
        user.name ?? "",
      ]);
      const handle = uniqueHandle(directory, user);

      if (score !== undefined && handle !== undefined) {
        const detail = user.realName ?? "";

        scored.push({
          label: `@${handle}`,
          slack: `<@${user.id}>`,
          detail:
            detail !== "" && !sameHandle(detail, handle) ? detail : undefined,
          score,
          kind: "user",
          sort: handle.toLowerCase(),
        });
      }
    }

    for (const group of directory.userGroups) {
      const handle = handleOf(group.handle);
      const score =
        handle === undefined
          ? undefined
          : matchScore(query, [handle], [group.name ?? ""]);

      if (score !== undefined && handle !== undefined) {
        scored.push({
          label: `@${handle}`,
          slack: `<!subteam^${group.id}>`,
          detail: group.name,
          score,
          kind: "group",
          sort: handle.toLowerCase(),
        });
      }
    }

    for (const name of broadcasts) {
      const score = matchScore(query, [name], []);

      if (score !== undefined) {
        scored.push({
          label: `@${name}`,
          slack: `<!${name}>`,
          score,
          kind: "broadcast",
          sort: String(broadcasts.indexOf(name)),
        });
      }
    }
  }

  const emptyQuery = query === "";

  return scored
    .sort(
      (a, b) =>
        a.score - b.score ||
        (emptyQuery
          ? kindOrder[b.kind] - kindOrder[a.kind]
          : kindOrder[a.kind] - kindOrder[b.kind]) ||
        a.sort.localeCompare(b.sort),
    )
    .slice(0, maxCompletions)
    .map(({ label, slack, detail }) => ({ label, slack, detail }));
}
