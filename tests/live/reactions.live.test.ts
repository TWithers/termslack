import { afterAll, describe, expect, test } from "bun:test";
import { slackClient } from "../../src/slack/client";

/**
 * Talks to real Slack as you. Skipped unless TERMSLACK_USER_TOKEN is set; `bun run
 * test:live` fills it in from your stored workspace. Posts one clearly
 * labelled message to your own self-DM, reacts to it, takes the reaction
 * back, and deletes the message afterwards even if the test stopped early.
 */
const userToken = process.env.TERMSLACK_USER_TOKEN;

describe.skipIf(!userToken)("live Slack reactions", () => {
  const client = () => slackClient(userToken);
  const posted: { channel: string; ts: string }[] = [];

  afterAll(async () => {
    for (const { channel, ts } of posted) {
      await client()
        .chat.delete({ channel, ts })
        .catch(() => undefined);
    }
  });

  test("reactions.add and reactions.remove answer with their shapes, and history shows the reaction with your id", async () => {
    const { user_id: ownId = "" } = await client().auth.test();
    const opened = await client().conversations.open({ users: ownId });
    const channel = opened.channel?.id ?? "";

    expect(channel).not.toBe("");

    const post = await client().chat.postMessage({
      channel,
      text: `termslack live test for reactions (safe to delete) ${Date.now()}`,
    });

    posted.push({ channel, ts: post.ts! });

    const added = await client().reactions.add({
      channel,
      timestamp: post.ts!,
      name: "white_check_mark",
    });

    expect(added.ok).toBe(true);

    const reactionsOnMessage = async () => {
      const history = await client().conversations.history({
        channel,
        latest: post.ts,
        inclusive: true,
        limit: 1,
      });

      return history.messages?.[0]?.reactions ?? [];
    };

    expect(await reactionsOnMessage()).toEqual([
      expect.objectContaining({
        name: "white_check_mark",
        users: [ownId],
        count: 1,
      }),
    ]);

    const again = await client()
      .reactions.add({ channel, timestamp: post.ts!, name: "white_check_mark" })
      .catch((error: { data?: { error?: string } }) => error);

    expect((again as { data?: { error?: string } }).data?.error).toBe(
      "already_reacted",
    );

    const removed = await client().reactions.remove({
      channel,
      timestamp: post.ts!,
      name: "white_check_mark",
    });

    expect(removed.ok).toBe(true);
    expect(await reactionsOnMessage()).toEqual([]);
  });
});
