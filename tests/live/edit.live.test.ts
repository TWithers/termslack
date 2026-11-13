import { afterAll, describe, expect, test } from "bun:test";
import { slackClient } from "../../src/slack/client";

/**
 * Talks to real Slack as you. Skipped unless TERMSLACK_USER_TOKEN is set; `bun run
 * test:live` fills it in from your stored workspace. Posts one clearly
 * labelled message to your own self-DM, edits it, deletes it, and deletes it
 * again afterwards if the test stopped before it got that far.
 */
const userToken = process.env.TERMSLACK_USER_TOKEN;

describe.skipIf(!userToken)("live Slack editing and deleting", () => {
  const client = () => slackClient(userToken);
  const posted: { channel: string; ts: string }[] = [];

  afterAll(async () => {
    for (const { channel, ts } of posted) {
      await client()
        .chat.delete({ channel, ts })
        .catch(() => undefined);
    }
  });

  test("chat.update and chat.delete answer with their shapes, and the edit shows in history", async () => {
    const { user_id: ownId = "" } = await client().auth.test();
    const opened = await client().conversations.open({ users: ownId });
    const channel = opened.channel?.id ?? "";

    expect(channel).not.toBe("");

    const stamp = Date.now();
    const post = await client().chat.postMessage({
      channel,
      text: `termslack live test before edit (safe to delete) ${stamp}`,
    });

    posted.push({ channel, ts: post.ts! });

    const text = `termslack live test after edit &amp; more (safe to delete) ${stamp}`;
    const updated = await client().chat.update({
      channel,
      ts: post.ts!,
      text,
    });

    expect(updated.ok).toBe(true);
    expect(updated.ts).toBe(post.ts);
    expect(updated.channel).toBe(channel);
    expect(updated.text).toBe(text);

    const history = await client().conversations.history({
      channel,
      latest: post.ts,
      inclusive: true,
      limit: 1,
    });
    const [fetched] = history.messages ?? [];

    expect(fetched?.text).toBe(text);
    expect(fetched?.edited?.user).toBe(ownId);

    const deleted = await client().chat.delete({ channel, ts: post.ts! });

    expect(deleted.ok).toBe(true);
    expect(deleted.ts).toBe(post.ts);
    expect(deleted.channel).toBe(channel);
  });
});
