/*
 * Part of the Slack boundary: the only place that reads the shape of errors
 * the Slack SDK rejects with.
 */

type SlackErrorData = { error?: string; errors?: unknown };

function slackErrorData(error: unknown): SlackErrorData | undefined {
  return (error as { data?: SlackErrorData } | undefined)?.data;
}

/** Slack's error code (e.g. `channel_not_found`), when the error came from Slack. */
export function slackErrorCode(error: unknown): string | undefined {
  return slackErrorData(error)?.error;
}

/** The detail entries Slack attaches to some errors, e.g. manifest validation problems. */
export function slackErrorDetails(error: unknown): unknown {
  return slackErrorData(error)?.errors;
}
