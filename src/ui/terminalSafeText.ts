/** The Fitzpatrick skin tone modifiers, U+1F3FB to U+1F3FF. */
const skinToneModifiers = /[\u{1F3FB}-\u{1F3FF}]/gu;

const zeroWidthJoiner = /\u200D/g;

/** U+FE0F, which asks for a symbol such as ❤ to be drawn as a colour emoji. */
const emojiPresentationSelector = /\uFE0F/g;

/** U+20E3, which draws the character before it as a keycap (1️⃣). */
const combiningKeycap = /\u20E3/g;

/**
 * `text` as termslack draws it. Terminals that don't cluster graphemes draw a skin
 * tone as a swatch beside its emoji and a joined sequence as its parts, so a
 * row measured with them as one 2-cell emoji overflows the width. Skin tones
 * are left out and joined sequences are split into their parts (👨‍👩‍👧 becomes
 * 👨👩👧), so every terminal draws, and termslack measures, the same cells.
 * Terminals also disagree on a symbol drawn as emoji (❤️, ⚠️, ✔️): some give
 * it two cells, some one. The emoji selector is left out so every terminal
 * draws the plain one-cell symbol (❤), and keycaps (1️⃣) are drawn as their
 * character (1). Only for what is drawn: never for text sent to Slack.
 */
export function terminalSafeText(text: string): string {
  return text
    .replace(skinToneModifiers, "")
    .replace(zeroWidthJoiner, "")
    .replace(emojiPresentationSelector, "")
    .replace(combiningKeycap, "");
}

/** The cells `text` takes once drawn. */
export function cellWidth(text: string): number {
  return Bun.stringWidth(terminalSafeText(text));
}
