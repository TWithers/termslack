import { describeFailure } from "./failureText";

const editFailures: Record<string, string> = {
  cant_update_message: "Slack won't let you edit that message.",
  edit_window_closed: "That message is too old to edit.",
  msg_too_long: "The message is too long for Slack.",
};

const deleteFailures: Record<string, string> = {
  cant_delete_message: "Slack won't let you delete that message.",
  message_not_found: "Slack can't find that message; it may already be gone.",
};

const reactionFailures: Record<string, string> = {
  too_many_reactions:
    "That message already has the most reactions Slack allows.",
  invalid_name: "Slack doesn't know an emoji with that name.",
  not_reactable: "Slack doesn't allow reactions on that message.",
};

function describeMessageFailure(
  error: unknown,
  failures: Record<string, string>,
  verb: "edit" | "delete",
): string {
  return describeFailure(error, {
    failures,
    missingScope: `To ${verb} messages termslack needs the chat:write permission. Run termslack's setup again to grant it.`,
    refused: `Slack refused to ${verb} the message`,
    couldnt: `Couldn't ${verb} the message`,
  });
}

/** Why an edit was refused, in words for the status bar. */
export function describeEditFailure(error: unknown): string {
  return describeMessageFailure(error, editFailures, "edit");
}

/** Why a delete was refused, in words for the status bar. */
export function describeDeleteFailure(error: unknown): string {
  return describeMessageFailure(error, deleteFailures, "delete");
}

/** Why adding or removing a reaction was refused, in words for the status bar. */
export function describeReactionFailure(
  error: unknown,
  verb: "add" | "remove",
): string {
  return describeFailure(error, {
    failures: reactionFailures,
    missingScope:
      "To react termslack needs the reactions:write permission. Run termslack's setup again to grant it.",
    refused: `Slack refused to ${verb} the reaction`,
    couldnt: `Couldn't ${verb} the reaction`,
  });
}
