import { describeFailure } from "./failureText";

const sendFailures: Record<string, string> = {
  not_in_channel: "You aren't in this conversation, so you can't write to it.",
  is_archived: "This conversation is archived, so nothing can be sent to it.",
  msg_too_long: "The message is too long for Slack.",
  rate_limited: "Slack says you're sending too fast. Try again in a moment.",
};

/** Why a send failed, in words for the status line. */
export function describeSendFailure(error: unknown): string {
  return describeFailure(error, {
    failures: sendFailures,
    missingScope:
      "Sending needs the chat:write permission. Run termslack's setup again to grant it.",
    refused: "Slack refused the message",
    couldnt: "Couldn't send",
  });
}
