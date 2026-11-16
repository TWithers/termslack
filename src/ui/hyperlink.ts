const linkableScheme = /^(https?:\/\/|mailto:)/i;

/** Whitespace and control characters (C0, DEL, C1): none belong in an address, and ESC, BEL or ST would end the escape early. */
const unsafeCharacter = /[\s\p{Cc}]/u;

const osc8 = "\u001b]8;;";
const stringTerminator = "\u001b\\";

/**
 * `url` when it may be drawn as a terminal hyperlink: a web or mail address
 * with no whitespace or control characters. Addresses come from other
 * people's messages, so anything else (`javascript:`, `file:`, schemes a
 * terminal hands to some local app) is not linked.
 */
export function linkableUrl(url: string): string | undefined {
  if (!linkableScheme.test(url)) {
    return undefined;
  }

  return unsafeCharacter.test(url) ? undefined : url;
}

/**
 * `text` wrapped in OSC 8, so terminals that support hyperlinks open `url`
 * when it is clicked; others draw the text as it is. Text whose address
 * cannot be linked (`linkableUrl`) is returned plain.
 */
export function hyperlink(text: string, url: string): string {
  const linkable = linkableUrl(url);

  if (!linkable) {
    return text;
  }

  return `${osc8}${linkable}${stringTerminator}${text}${osc8}${stringTerminator}`;
}
