import { describe, expect, test } from "bun:test";
import { slackClient } from "../../src/slack/client";
import { convertDndStatus } from "../../src/slack/convert";

/**
 * Talks to real Slack as you. Skipped unless TERMSLACK_USER_TOKEN is set; `bun run
 * test:live` fills it in from your stored workspace. Asserts the response
 * shapes termslack relies on, never exact data. Read-only: it never changes your
 * Do Not Disturb.
 */
const userToken = process.env.TERMSLACK_USER_TOKEN;

const isOptionalNumber = (value: unknown) =>
  value === undefined || typeof value === "number";

describe.skipIf(!userToken)("live Slack Do Not Disturb", () => {
  test("dnd.info describes the user's Do Not Disturb with the fields termslack reads", async () => {
    const response: Record<string, any> =
      await slackClient(userToken).dnd.info();

    expect(response.ok).toBe(true);
    expect(response.dnd_enabled).toBeBoolean();
    expect(isOptionalNumber(response.next_dnd_start_ts)).toBe(true);
    expect(isOptionalNumber(response.next_dnd_end_ts)).toBe(true);
    expect(
      response.snooze_enabled === undefined ||
        typeof response.snooze_enabled === "boolean",
    ).toBe(true);

    if (response.snooze_enabled) {
      expect(response.snooze_endtime).toBeNumber();
    }

    expect(convertDndStatus(response)).toBeDefined();
  });
});
