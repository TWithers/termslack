import type { ContentBlock, StyledSegment } from "../session/content";
import type { MessageContent } from "../session/events";
import {
  type MessageTextLookup,
  renderMessageBody,
} from "../session/messageText";

const bullets = ["•", "◦", "▪"];

/** A segment as plain text: a link keeps its address after a label that differs from it; an interactive element's label is left out. */
function segmentText(segment: StyledSegment): string {
  if (segment.action) {
    return "";
  }

  if (segment.kind === "link" && segment.text !== segment.url) {
    return `${segment.text} (${segment.url})`;
  }

  return segment.text;
}

function inlineText(inline: StyledSegment[]): string {
  return inline.map(segmentText).join("");
}

/** A block's text as its one line, or no line when it has none (a row of buttons). */
function lineOf(inline: StyledSegment[]): string[] {
  const text = inlineText(inline);

  return text.trim() === "" ? [] : [text];
}

/**
 * The lines of one block, without the pane's decoration (quote and colour
 * bars, indents) or its wrapping. A divider is a blank line.
 */
function blockText(block: ContentBlock<StyledSegment>): string[] {
  switch (block.kind) {
    case "paragraph":
    case "quote":
    case "code":
    case "header":
    case "context":
    case "image":
    case "actions":
      return lineOf(block.inline);
    case "divider":
      return [""];
    case "list":
      return block.items.map((item, index) => {
        const marker = block.ordered
          ? `${block.start + index}.`
          : bullets[block.indent % bullets.length]!;

        return `${"  ".repeat(block.indent)}${marker} ${inlineText(item)}`;
      });
    case "fields":
      return block.fields.flatMap((field) => field.blocks.flatMap(blockText));
    case "attachment":
      return [...block.pretext, ...block.blocks].flatMap(blockText);
  }
}

/**
 * What a message says, as plain text for the clipboard: the text the pane
 * shows, without styling, decoration or wrapping, and without buttons,
 * file names or "(edited)". Empty when the message has no text.
 */
export function messageCopyText(
  content: Pick<MessageContent, "text" | "fallbackText" | "body">,
  lookup: MessageTextLookup = {},
): string {
  const lines = renderMessageBody(content, lookup).flatMap(blockText);
  const withoutRepeatedBlanks = lines.filter(
    (line, index) => line !== "" || lines[index - 1] !== "",
  );

  return withoutRepeatedBlanks.join("\n").replace(/^\n+/, "").trimEnd();
}
