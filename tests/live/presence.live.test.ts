import { describe, expect, test } from "bun:test";
import { slackClient } from "../../src/slack/client";
import { convertPresence } from "../../src/slack/convert";

/**
 * Talks to real Slack as you. Skipped unless TERMSLACK_USER_TOKEN is set; `bun run
 * test:live` fills it in from your stored workspace. Asserts the response
 * shapes termslack relies on, never exact data. Read-only: it only asks about your
 * own presence.
 */
const userToken = process.env.TERMSLACK_USER_TOKEN;

describe.skipIf(!userToken)("live Slack presence", () => {
  test("users.getPresence for the user's own ID answers active or away", async () => {
    const client = slackClient(userToken);
    const auth = await client.auth.test();
    const response: Record<string, any> = await client.users.getPresence({
      user: auth.user_id!,
    });

    expect(response.ok).toBe(true);
    expect(["active", "away"]).toContain(response.presence);
    expect(convertPresence(response)).toBe(response.presence);
  });
});
