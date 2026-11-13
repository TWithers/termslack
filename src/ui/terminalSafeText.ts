/** The Fitzpatrick skin tone modifiers, U+1F3FB to U+1F3FF. */
const skinToneModifiers = /[\u{1F3FB}-\u{1F3FF}]/gu;

const zeroWidthJoiner = /\u200D/g;

/**
 * `text` as termslack draws it. Terminals that don't cluster graphemes draw a skin
 * tone as a swatch beside its emoji and a joined sequence as its parts, so a
 * row measured with them as one 2-cell emoji overflows the width. Skin tones
 * are left out and joined sequences are split into their parts (👨‍👩‍👧 becomes
 * 👨👩👧), so every terminal draws, and termslack measures, the same cells. Only for
 * what is drawn: never for text sent to Slack.
 */
export function terminalSafeText(text: string): string {
  return text.replace(skinToneModifiers, "").replace(zeroWidthJoiner, "");
}

/** The cells `text` takes once drawn. */
export function cellWidth(text: string): number {
  return Bun.stringWidth(terminalSafeText(text));
}
