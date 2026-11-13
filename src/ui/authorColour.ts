import type { Author, Bot, User } from "../session/events";
import { legibleOn } from "./colour";
import { theme } from "./theme";

/** What author colours may ask the store for. */
export type ColourLookup = {
  user?(id: string): User | undefined;
  bot?(id: string): Bot | undefined;
};

/**
 * `#rrggbb` as is when it reads clearly on `background` (the chosen theme's
 * pane by default); otherwise mixed just far enough towards white (on a dark
 * background) or black (on a light one).
 */
export function legibleColour(
  hex: string,
  background: string = theme.paneBackground,
): string {
  return legibleOn(hex, background);
}

/** A stable palette colour for `key`: the same key always gets the same one. */
export function fallbackColour(key: string): string {
  let hash = 0;

  for (const character of key) {
    hash = (Math.imul(hash, 31) + character.codePointAt(0)!) >>> 0;
  }

  return theme.fallbackNameColours[hash % theme.fallbackNameColours.length]!;
}

/**
 * The colour of an author's name on `background`: the person's Slack colour,
 * else a stable one from the theme's fallback names by user ID, bot ID or bot
 * name; the theme's default when there is nothing to go by. Made legible.
 */
export function authorColour(
  source: Author,
  lookup: ColourLookup,
  background: string = theme.paneBackground,
): string {
  const slackColour = source.userId
    ? lookup.user?.(source.userId)?.color
    : undefined;
  const key = source.userId ?? source.botId ?? source.botName;

  return legibleColour(
    slackColour ??
      (key === undefined ? theme.defaultNameColour : fallbackColour(key)),
    background,
  );
}
