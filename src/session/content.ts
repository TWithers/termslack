import type { MessageSegment } from "./messageText";

/** Which text styles apply to a stretch of text. Absent flags are off. */
export type TextStyle = {
  bold?: true;
  italic?: true;
  strike?: true;
  code?: true;
};

/**
 * A stretch of inline text in one style, as Slack markup: `<@U1>`, `<#C1>`,
 * `<url|label>` and `:shortcode:` are resolved when the message is shown, and
 * `&amp;`, `&lt;` and `&gt;` are decoded then. A `"\n"` is a line break.
 */
export type Span = { markup: string; style?: TextStyle };

/** A resolved inline piece: a message segment with the style it was written in. */
export type StyledSegment = MessageSegment & { style?: TextStyle };

/** One title/value pair of a grid of fields. `wide` fields take the full width; the others sit two to a row when there is room. */
export type ContentField<Inline = Span> = {
  blocks: ContentBlock<Inline>[];
  wide: boolean;
};

/**
 * The display structure of a message body, with inline content of type
 * `Inline`: `Span` as conversion produces it, `StyledSegment` once names and
 * emoji are resolved for display.
 */
export type ContentBlock<Inline = Span> =
  | { kind: "paragraph"; inline: Inline[] }
  | { kind: "quote"; inline: Inline[] }
  /** Nested lists are further lists with a greater `indent`. `start` is the number of the first item of an ordered list. */
  | {
      kind: "list";
      ordered: boolean;
      indent: number;
      start: number;
      items: Inline[][];
    }
  /** Preformatted text: line breaks and spaces are kept. */
  | { kind: "code"; inline: Inline[] }
  /** A Block Kit `header`: its spans are already bold. */
  | { kind: "header"; inline: Inline[] }
  /** Small text: Block Kit `context` elements, an attachment's author and footer. Shown dim. */
  | { kind: "context"; inline: Inline[] }
  /** Interactive elements as their labels (`[Approve]`). Not clickable. */
  | { kind: "actions"; inline: Inline[] }
  /** An image as a link: its alt text or title linking to its address. */
  | { kind: "image"; inline: Inline[] }
  | { kind: "divider" }
  /** Title/value pairs: attachment fields and Block Kit section fields. */
  | { kind: "fields"; fields: ContentField<Inline>[] }
  /**
   * A legacy attachment: `pretext` above, then `blocks` beside a colour bar.
   * `color` is `good`, `warning`, `danger` or `#rrggbb`; `fallback` is the
   * attachment's plain-text summary, kept to spot a message `text` repeating it.
   */
  | {
      kind: "attachment";
      color?: string;
      fallback?: string;
      pretext: ContentBlock<Inline>[];
      blocks: ContentBlock<Inline>[];
    };
