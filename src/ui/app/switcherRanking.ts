import type { ConversationMarkers } from "../../session/unreadTracker";

/** Something the quick switcher can open. */
export type SwitcherCandidate = {
  /** The conversation's ID, or `user:<ID>` for a person with no DM yet. */
  id: string;
  /** Set for a person with no DM yet: picking them starts one. */
  userId?: string;
  /** What the row shows: `#general`, `@sarah`, `@sarah, ray`. */
  label: string;
  /** Every name the filter matches against, without the `#` or `@`. */
  names: string[];
  markers: ConversationMarkers;
  /** A dim remark after the label, such as `private`. */
  note?: string;
  /** A channel muted in termslack: its name is dimmed and the note says "muted". */
  muted?: boolean;
  /** A public channel the user isn't in: shown dimmed, ranked after what they are in, and picking it asks to join. */
  notMember?: boolean;
};

/** How well a name matches the filter, best first. */
const Match = { Exact: 0, Prefix: 1, WordStart: 2, InOrder: 3 } as const;

const isWordCharacter = (character: string | undefined) =>
  character !== undefined && /[\p{L}\p{N}]/u.test(character);

/** The filter as matched: lowercase, without spaces around it or a leading `#` or `@`. */
export function normalizeFilter(filter: string): string {
  return filter.trim().replace(/^[#@]/, "").trim().toLowerCase();
}

function hasInOrder(name: string, query: string): boolean {
  let at = 0;

  for (const character of query) {
    at = name.indexOf(character, at) + 1;

    if (at === 0) {
      return false;
    }
  }

  return true;
}

function startsAWord(name: string, query: string): boolean {
  for (
    let at = name.indexOf(query);
    at !== -1;
    at = name.indexOf(query, at + 1)
  ) {
    if (!isWordCharacter(name[at - 1])) {
      return true;
    }
  }

  return false;
}

function matchOf(name: string, query: string): number | undefined {
  const lower = name.toLowerCase();

  if (lower === query) {
    return Match.Exact;
  }

  if (lower.startsWith(query)) {
    return Match.Prefix;
  }

  if (startsAWord(lower, query)) {
    return Match.WordStart;
  }

  return hasInOrder(lower, query) ? Match.InOrder : undefined;
}

/** The best match among a candidate's names, or undefined when none contains the letters in order. */
export function bestMatch(names: string[], query: string): number | undefined {
  const matches = names
    .map((name) => matchOf(name, query))
    .filter((match) => match !== undefined);

  return matches.length > 0 ? Math.min(...matches) : undefined;
}

const isLoud = ({ isUnread, mentions }: ConversationMarkers) =>
  isUnread || mentions > 0;

/**
 * The candidates the filter keeps, best first. The letters must appear in
 * order, ignoring case. An exact match ranks first, then a prefix, then one
 * at the start of a word (`dep` finds `team-deploys`), then any other. Ties
 * go to conversations the user is in, then unread ones, then the most recently
 * opened (`recent`, newest first), then alphabetically. With no filter, everything is listed: the
 * conversations the user is in (the recently opened first, then the unread,
 * then the rest alphabetically), then the channels they aren't in in that same order.
 */
export function rankCandidates(
  candidates: SwitcherCandidate[],
  filter: string,
  recent: string[],
): SwitcherCandidate[] {
  const query = normalizeFilter(filter);
  const recency = (id: string) => {
    const index = recent.indexOf(id);

    return index === -1 ? Number.POSITIVE_INFINITY : index;
  };
  const byMembership = (a: SwitcherCandidate, b: SwitcherCandidate) =>
    Number(a.notMember === true) - Number(b.notMember === true);
  const byAttention = (a: SwitcherCandidate, b: SwitcherCandidate) =>
    byMembership(a, b) ||
    Number(isLoud(b.markers)) - Number(isLoud(a.markers)) ||
    recency(a.id) - recency(b.id) ||
    a.label.localeCompare(b.label);

  if (query === "") {
    return [...candidates].sort(
      (a, b) =>
        byMembership(a, b) ||
        Number(recency(b.id) !== Infinity) -
          Number(recency(a.id) !== Infinity) ||
        recency(a.id) - recency(b.id) ||
        byAttention(a, b),
    );
  }

  return candidates
    .flatMap((candidate) => {
      const match = bestMatch(candidate.names, query);

      return match === undefined ? [] : [{ candidate, match }];
    })
    .sort((a, b) => a.match - b.match || byAttention(a.candidate, b.candidate))
    .map(({ candidate }) => candidate);
}
