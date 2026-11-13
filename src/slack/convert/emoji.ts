import type { CustomEmoji, SlackEvent } from "../../session/events";
import { isObject, optionalString, timestampOf, unrecognized } from "./shared";

export function convertEmojiEvent(
  envelopeType: string,
  body: Record<string, any>,
  event: Record<string, any>,
): SlackEvent {
  const base = { timestamp: timestampOf(event), raw: body, issues: [] };
  const aliasOf = aliasTarget(event.value);

  if (event.subtype === "add" && optionalString(event.name)) {
    return {
      kind: "emoji",
      action: "added",
      names: [event.name],
      aliasOf,
      ...base,
    };
  }

  if (event.subtype === "remove" && Array.isArray(event.names)) {
    return {
      kind: "emoji",
      action: "removed",
      names: event.names.filter(
        (name: unknown): name is string =>
          typeof name === "string" && name !== "",
      ),
      ...base,
    };
  }

  if (
    event.subtype === "rename" &&
    optionalString(event.old_name) &&
    optionalString(event.new_name)
  ) {
    return {
      kind: "emoji",
      action: "renamed",
      names: [event.new_name],
      oldName: event.old_name,
      aliasOf,
      ...base,
    };
  }

  return unrecognized(envelopeType, body);
}

/** What an `emoji.list` or `emoji_changed` value aliases: `alias:other` names another emoji, a URL names none. */
function aliasTarget(value: unknown): string | undefined {
  return typeof value === "string" && value.startsWith("alias:")
    ? optionalString(value.slice("alias:".length))
    : undefined;
}

/** The custom emoji from `emoji.list`; entries that aren't a string value are skipped. */
export function convertCustomEmoji(
  response: Record<string, any>,
): CustomEmoji[] {
  const entries = isObject(response.emoji)
    ? Object.entries(response.emoji)
    : [];

  return entries.flatMap(([name, value]) =>
    typeof value === "string" && name !== ""
      ? [{ name, aliasOf: aliasTarget(value) }]
      : [],
  );
}
