import { describe, expect, test } from "bun:test";
import { slackClient } from "../../src/slack/client";
import { convertCustomEmoji } from "../../src/slack/convert";

/**
 * Talks to real Slack as you. Skipped unless TERMSLACK_USER_TOKEN is set; `bun run
 * test:live` fills it in from your stored workspace. Asserts the response
 * shapes termslack relies on, never exact data.
 */
const userToken = process.env.TERMSLACK_USER_TOKEN;

describe.skipIf(!userToken)("live Slack emoji", () => {
  test("emoji.list maps names to image URLs or alias:name", async () => {
    const response = await slackClient(userToken).emoji.list();

    expect(response.ok).toBe(true);
    expect(response.emoji).toBeObject();

    for (const value of Object.values(response.emoji!)) {
      expect(value).toBeString();
    }

    expect(convertCustomEmoji(response).length).toBe(
      Object.keys(response.emoji!).length,
    );
  });
});
