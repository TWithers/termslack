import emojiData from "emoji-datasource/emoji.json";
import type { CustomEmoji } from "./events";
import type { CompletionEntry } from "./mentions";

/** The few fields of iamcal's emoji-data that termslack reads. */
type EmojiRecord = {
  unified: string;
  short_names: string[];
  skin_variations?: Record<string, { unified: string }>;
};

/** What the lookups may ask the store for: the workspace's custom emoji. */
export type EmojiLookup = {
  customEmoji?(name: string): CustomEmoji | undefined;
  /** Every custom emoji's name, for completion. */
  customEmojiNames?(): string[];
};

/** One piece of text that may hold shortcodes: plain text, or an emoji (a character, or `:name:` for a custom one). */
export type EmojiPiece =
  | { kind: "text"; text: string }
  | { kind: "emoji"; text: string; shortcode: string };

/** Slack names a few emoji that emoji-data doesn't. */
const slackAliases: Record<string, string> = {
  simple_smile: "slightly_smiling_face",
};

/** `:skin-tone-2:` to `:skin-tone-6:` are the Fitzpatrick modifiers U+1F3FB to U+1F3FF. */
const skinToneCodes: Record<number, string> = {
  2: "1F3FB",
  3: "1F3FC",
  4: "1F3FD",
  5: "1F3FE",
  6: "1F3FF",
};

const maxAliasDepth = 5;

let records: Map<string, EmojiRecord> | undefined;

/** Built on first use, so a session that never shows an emoji doesn't pay for it. */
function standardRecords(): Map<string, EmojiRecord> {
  if (!records) {
    records = new Map();

    for (const record of emojiData as EmojiRecord[]) {
      for (const name of record.short_names) {
        records.set(name, record);
      }
    }

    for (const [alias, target] of Object.entries(slackAliases)) {
      const record = records.get(target);

      if (record && !records.has(alias)) {
        records.set(alias, record);
      }
    }
  }

  return records;
}

function characters(unified: string): string {
  return String.fromCodePoint(
    ...unified.split("-").map((hex) => Number.parseInt(hex, 16)),
  );
}

/**
 * The character for a standard shortcode (no colons), in a skin tone from 2
 * to 6 when the emoji has one. Undefined for anything else, including a skin
 * tone the emoji doesn't come in.
 */
export function standardEmoji(
  shortcode: string,
  skinTone?: number,
): string | undefined {
  const record = standardRecords().get(shortcode);

  if (!record) {
    return undefined;
  }

  if (skinTone === undefined) {
    return characters(record.unified);
  }

  const variation = record.skin_variations?.[skinToneCodes[skinTone] ?? ""];

  return variation ? characters(variation.unified) : undefined;
}

type Resolved = { text: string } | "custom" | undefined;

function resolve(
  name: string,
  skinTone: number | undefined,
  lookup: EmojiLookup,
): Resolved {
  let current = name;

  for (let depth = 0; depth <= maxAliasDepth; depth++) {
    const custom = lookup.customEmoji?.(current);

    if (!custom) {
      const standard = standardEmoji(current, skinTone);

      return standard ? { text: standard } : depth === 0 ? undefined : "custom";
    }

    if (!custom.aliasOf) {
      return "custom";
    }

    current = custom.aliasOf;
  }

  return "custom";
}

const shortcodePattern = /:([a-z0-9_+'-]+):(?::skin-tone-([2-6]):)?/g;

/**
 * Splits text into plain text and emoji. Standard shortcodes (with an
 * optional skin tone) become their character and custom ones stay as
 * `:name:`. Unknown shortcodes stay in the text. `protectedRanges` are
 * `[start, end)` spans, such as code, where nothing is converted.
 */
export function splitEmoji(
  text: string,
  lookup: EmojiLookup = {},
  protectedRanges: [number, number][] = [],
): EmojiPiece[] {
  const pieces: EmojiPiece[] = [];
  let plainFrom = 0;
  let from = 0;

  function addText(end: number): void {
    const value = text.slice(plainFrom, end);

    if (value === "") {
      return;
    }

    const last = pieces.at(-1);

    if (last?.kind === "text") {
      last.text += value;
    } else {
      pieces.push({ kind: "text", text: value });
    }
  }

  while (from < text.length) {
    shortcodePattern.lastIndex = from;

    const match = shortcodePattern.exec(text);

    if (!match) {
      break;
    }

    const start = match.index;
    const name = match[1]!;
    const tone = match[2] ? Number(match[2]) : undefined;
    const baseEnd = start + name.length + 2;

    if (protectedRanges.some(([low, high]) => start >= low && start < high)) {
      from = baseEnd - 1;
      continue;
    }

    const withTone = tone ? resolve(name, tone, lookup) : undefined;
    const usesTone = typeof withTone === "object";
    const resolved = usesTone ? withTone : resolve(name, undefined, lookup);
    const end = usesTone ? start + match[0].length : baseEnd;

    if (!resolved) {
      // The closing colon may open the next shortcode (`:nope:tada:`).
      from = baseEnd - 1;
      continue;
    }

    addText(start);
    pieces.push({
      kind: "emoji",
      shortcode: text.slice(start, end),
      text: resolved === "custom" ? text.slice(start, baseEnd) : resolved.text,
    });
    plainFrom = end;
    from = end;
  }

  addText(text.length);

  return pieces;
}

/** Replaces the standard shortcodes in a string with their characters; for reactions and status emoji. */
export function emojify(text: string, lookup: EmojiLookup = {}): string {
  return splitEmoji(text, lookup)
    .map((piece) => piece.text)
    .join("");
}

/**
 * The name Slack's reaction methods take, from what the user typed: `tada`,
 * `:tada:` and `:+1::skin-tone-2:` become `tada` and `+1::skin-tone-2` (the
 * form Slack itself uses for skin tones). Case is folded, as names are lower case.
 */
export function reactionName(typed: string): string {
  return typed.trim().replace(/^:/, "").replace(/:$/, "").toLowerCase();
}

/** How many names the emoji prompt lists at once. */
const maxEmojiCompletions = 6;

/** Names a completion can start from: letters, digits and the few symbols names hold. */
const completableQuery = /^[a-z0-9_+'-]*$/;

/**
 * Emoji names to offer for what has been typed so far: names starting with it
 * first, then names containing it, standard and custom together, shortest
 * first. Nothing for an empty query, or one with a skin tone (already specific).
 * Each entry's `label` is `:name:`, its `slack` the bare name to react with, and
 * its `detail` the character (or `custom`).
 */
export function emojiCompletions(
  typed: string,
  lookup: EmojiLookup = {},
): CompletionEntry[] {
  const query = reactionName(typed);

  if (query === "" || !completableQuery.test(query)) {
    return [];
  }

  const names = new Set([
    ...standardRecords().keys(),
    ...(lookup.customEmojiNames?.() ?? []),
  ]);
  const matches = [...names].filter((name) => name.includes(query));
  const rank = (name: string) => (name.startsWith(query) ? 0 : 1);

  return matches
    .sort(
      (a, b) => rank(a) - rank(b) || a.length - b.length || a.localeCompare(b),
    )
    .slice(0, maxEmojiCompletions)
    .map((name) => ({
      label: `:${name}:`,
      slack: name,
      detail:
        emojify(`:${name}:`, lookup) === `:${name}:`
          ? "custom"
          : emojify(`:${name}:`, lookup),
    }));
}
