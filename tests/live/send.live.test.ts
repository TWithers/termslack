import { afterAll, describe, expect, test } from "bun:test";
import { slackClient } from "../../src/slack/client";

/**
 * Talks to real Slack as you. Skipped unless TERMSLACK_USER_TOKEN is set; `bun run
 * test:live` fills it in from your stored workspace. Posts one clearly
 * labelled message to your own self-DM and always deletes it afterwards.
 *
 * Sending reconciles the pending message with the response and the socket
 * echo by `client_msg_id` when Slack carries it through, else by `ts`. Live
 * tests have no Socket Mode, so this checks what can be checked from the
 * user token: the response shape, and whether a message read back from
 * history carries the `client_msg_id` it was posted with (a hint at what the
 * echo carries). Either answer is accepted; it is annotated, not asserted.
 */
const userToken = process.env.TERMSLACK_USER_TOKEN;

describe.skipIf(!userToken)("live Slack sending", () => {
  const client = () => slackClient(userToken);
  const posted: { channel: string; ts: string }[] = [];

  afterAll(async () => {
    // Newest first, so a reply goes before its parent.
    for (const { channel, ts } of [...posted].reverse()) {
      await client()
        .chat.delete({ channel, ts })
        .catch((error) =>
          console.warn(
            `Couldn't delete the termslack test message ${ts} in ${channel}: ${error}`,
          ),
        );
    }
  });

  /** The self-DM's channel ID and the user's own ID. */
  async function selfDm() {
    const { user_id: ownId = "" } = await client().auth.test();
    const opened = await client().conversations.open({ users: ownId });

    return { ownId, channel: opened.channel?.id ?? "" };
  }

  test("chat.postMessage with a client_msg_id answers with the ts and the message, and history shows it", async () => {
    const { user_id: ownId = "" } = await client().auth.test();

    expect(ownId).not.toBe("");

    const opened = await client().conversations.open({ users: ownId });
    const channel = opened.channel?.id;

    expect(channel).toBeString();

    const clientMsgId = crypto.randomUUID();
    const text = `termslack live test (safe to delete): a & b < c > d ${Date.now()}`;
    const response = await client().chat.postMessage({
      channel: channel!,
      text: text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;"),
      client_msg_id: clientMsgId,
    } as Parameters<ReturnType<typeof client>["chat"]["postMessage"]>[0]);

    if (response.ts) {
      posted.push({ channel: channel!, ts: response.ts });
    }

    expect(response.ok).toBe(true);
    expect(response.ts).toMatch(/^\d+\.\d+$/);
    expect(response.channel).toBe(channel);
    expect(response.message?.ts).toBe(response.ts);
    expect(response.message?.user).toBe(ownId);
    expect(response.message?.text).toBe(
      text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
    );

    const history = await client().conversations.history({
      channel: channel!,
      latest: response.ts,
      inclusive: true,
      limit: 1,
    });
    const [fetched] = history.messages ?? [];

    expect(fetched?.ts).toBe(response.ts);

    const roundTrips = (fetched as { client_msg_id?: string } | undefined)
      ?.client_msg_id;

    console.log(
      `client_msg_id in the response message: ${
        (response.message as { client_msg_id?: string } | undefined)
          ?.client_msg_id ?? "absent"
      }; in history: ${roundTrips ?? "absent"} (posted ${clientMsgId})`,
    );

    if (roundTrips !== undefined) {
      expect(roundTrips).toBe(clientMsgId);
    }
  });

  test("a reply posted with thread_ts answers with the thread and the message", async () => {
    const { ownId, channel } = await selfDm();

    expect(channel).not.toBe("");

    const parent = await client().chat.postMessage({
      channel,
      text: `termslack live test parent (safe to delete) ${Date.now()}`,
    });

    posted.push({ channel, ts: parent.ts! });

    const clientMsgId = crypto.randomUUID();
    const response = await client().chat.postMessage({
      channel,
      text: "termslack live test reply (safe to delete)",
      thread_ts: parent.ts,
      client_msg_id: clientMsgId,
    } as Parameters<ReturnType<typeof client>["chat"]["postMessage"]>[0]);

    if (response.ts) {
      posted.push({ channel, ts: response.ts });
    }

    expect(response.ok).toBe(true);
    expect(response.ts).toMatch(/^\d+\.\d+$/);
    expect(response.ts).not.toBe(parent.ts);
    expect(response.message?.ts).toBe(response.ts);
    expect(response.message?.user).toBe(ownId);
    expect(
      (response.message as { thread_ts?: string } | undefined)?.thread_ts,
    ).toBe(parent.ts);
  });
});
