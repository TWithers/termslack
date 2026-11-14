import { slackErrorCode } from "../slack/errors";

/** An error's own message, or the thrown value as text. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** What Slack means by these codes for every action that writes to a conversation. */
export const commonFailures: Record<string, string> = {
  channel_not_found: "Slack can't find this conversation.",
  is_archived:
    "This conversation is archived, so nothing can be changed in it.",
  message_not_found: "Slack can't find that message any more.",
  rate_limited: "Slack says you're going too fast. Try again in a moment.",
};

/**
 * Why a write failed, in words for the status line: a missing scope, a Slack
 * code (the action's own wording first, then the common one), or whatever
 * the error says when it didn't come from Slack.
 */
export function describeFailure(
  error: unknown,
  action: {
    /** The action's wording for codes that differ from, or aren't in, `commonFailures`. */
    failures: Record<string, string>;
    missingScope: string;
    /** Start of the message for a Slack code with no wording: "<refused> (<code>)." */
    refused: string;
    /** Start of the message for any other error: "<couldnt>: <message>" */
    couldnt: string;
  },
): string {
  const code = slackErrorCode(error);

  if (code === "missing_scope") {
    return action.missingScope;
  }

  if (code !== undefined) {
    return (
      action.failures[code] ??
      commonFailures[code] ??
      `${action.refused} (${code}).`
    );
  }

  return `${action.couldnt}: ${errorMessage(error)}`;
}

/** Why a conversation's history couldn't be loaded, in words for the status line. `switcherKeys` names the keys that open the quick switcher. */
export function describeHistoryFailure(
  error: unknown,
  switcherKeys: string,
): string {
  return describeFailure(error, {
    failures: {
      not_in_channel: `Slack doesn't let you read this channel without joining it. Join it from the quick switcher (${switcherKeys}).`,
      channel_not_found:
        "Slack won't show this conversation (it's private, or gone).",
    },
    missingScope:
      "termslack's token lacks the permission to read this conversation's history. Run termslack's setup again to grant it.",
    refused: "Slack refused to load the messages",
    couldnt: "Couldn't load the messages",
  });
}
