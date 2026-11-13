import { LogLevel, WebClient, type WebClientOptions } from "@slack/web-api";

/** Failures already surface through thrown errors and `disconnected`; the SDK's own console lines would just duplicate them, and a warning (`already_in_channel`) would be drawn over the UI. */
export const silentLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  setLevel: () => {},
  getLevel: () => LogLevel.ERROR,
  setName: () => {},
};

/**
 * TERMSLACK_SLACK_API_URL points every Web API call (and the Socket Mode handshake)
 * at another server, e.g. the fake Slack used in tests. Retries are disabled
 * there so failures surface immediately instead of backing off for minutes.
 */
export function slackClientOptions(): WebClientOptions {
  const slackApiUrl = process.env.TERMSLACK_SLACK_API_URL;

  if (!slackApiUrl) {
    return {};
  }

  return { slackApiUrl, retryConfig: { retries: 0 } };
}

export function slackClient(token?: string): WebClient {
  return new WebClient(token, {
    logger: silentLogger,
    ...slackClientOptions(),
  });
}
