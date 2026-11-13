import { describe, expect, test } from "bun:test";
import { conversationTypes } from "../../src/slack/conversations";
import { slackClient } from "../../src/slack/client";
import {
  convertJoinedChannel,
  convertOpenedDirectMessage,
  convertPublicChannelsPage,
} from "../../src/slack/convert";

/**
 * Talks to real Slack as you. Skipped unless TERMSLACK_USER_TOKEN is set; `bun run
 * test:live` fills it in from your stored workspace. Asserts the response
 * shapes termslack relies on, never exact data.
 */
const userToken = process.env.TERMSLACK_USER_TOKEN;

describe.skipIf(!userToken)("live Slack conversations", () => {
  const client = () => slackClient(userToken);

  test("users.conversations lists your conversations with the fields termslack reads", async () => {
    const response = await client().users.conversations({
      types: conversationTypes,
      limit: 50,
    });

    expect(response.ok).toBe(true);
    expect(Array.isArray(response.channels)).toBe(true);
    expect(typeof response.response_metadata?.next_cursor).toMatch(
      /^(string|undefined)$/,
    );

    for (const conversation of response.channels ?? []) {
      expect(conversation.id).toBeString();

      const isDirect = conversation.is_im || conversation.is_mpim;

      if (conversation.is_im) {
        expect(conversation.user).toBeString();
      } else {
        expect(conversation.name).toBeString();
      }

      if (!isDirect) {
        expect(conversation.is_private).toBeBoolean();
      }
    }
  });

  test("users.conversations pages with the cursor", async () => {
    const first = await client().users.conversations({
      types: conversationTypes,
      limit: 1,
    });
    const cursor = first.response_metadata?.next_cursor;

    if (!cursor) {
      return;
    }

    const second = await client().users.conversations({
      types: conversationTypes,
      limit: 1,
      cursor,
    });

    expect(second.ok).toBe(true);
    expect(second.channels?.[0]?.id).not.toBe(first.channels?.[0]?.id);
  });

  test("conversations.info describes a conversation with the fields termslack reads", async () => {
    const { channels } = await client().users.conversations({
      types: "public_channel,private_channel",
      limit: 1,
    });
    const id = channels?.[0]?.id;

    if (!id) {
      return;
    }

    const { ok, channel } = await client().conversations.info({ channel: id });

    expect(ok).toBe(true);
    expect(channel?.id).toBe(id);
    expect(channel?.name).toBeString();
    expect(channel?.is_archived).toBeBoolean();
    expect(channel?.is_private).toBeBoolean();
  });

  test("conversations.info reports an unknown channel as channel_not_found", async () => {
    const error = await client()
      .conversations.info({ channel: "C0000000000" })
      .catch((caught) => caught);

    expect(error.data?.error).toBe("channel_not_found");
  });

  test("im and mpim conversations carry an updated time in ms", async () => {
    const { channels } = await client().users.conversations({
      types: "im,mpim",
      limit: 20,
    });

    for (const conversation of channels ?? []) {
      expect(conversation.updated).toBeNumber();
    }
  });

  test("search.messages finds DM messages since a day, with the fields the catch-up reads", async () => {
    const day = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const response = await client().search.messages({
      query: `is:dm after:${day}`,
      sort: "timestamp",
      sort_dir: "desc",
      count: 20,
      page: 1,
    });

    expect(response.ok).toBe(true);
    expect(response.messages?.paging?.page).toBeNumber();
    expect(response.messages?.paging?.pages).toBeNumber();

    for (const match of response.messages?.matches ?? []) {
      expect(match.ts).toBeString();
      expect(match.channel?.id).toBeString();
      expect(
        match.channel?.is_im === true || match.channel?.is_mpim === true,
      ).toBe(true);
    }
  });

  test("conversations.info reports last_read for a channel and for a DM", async () => {
    for (const types of ["public_channel,private_channel", "im"]) {
      const { channels } = await client().users.conversations({
        types,
        limit: 1,
      });
      const id = channels?.[0]?.id;

      if (!id) {
        continue;
      }

      const { channel } = await client().conversations.info({ channel: id });

      expect(channel?.last_read).toMatch(/^\d+\.\d+$/);
    }
  });

  test("conversations.mark with the current last_read succeeds and changes nothing", async () => {
    const { channels } = await client().users.conversations({
      types: "public_channel",
      limit: 1,
    });
    const id = channels?.[0]?.id;

    if (!id) {
      return;
    }

    const before = (await client().conversations.info({ channel: id })).channel
      ?.last_read;

    if (!before) {
      return;
    }

    const marked = await client().conversations.mark({
      channel: id,
      ts: before,
    });

    expect(marked.ok).toBe(true);

    const after = (await client().conversations.info({ channel: id })).channel
      ?.last_read;

    expect(after).toBe(before);
  });
  test("conversations.info gives last_read for every kind, and an unread count for DMs only", async () => {
    const { channels = [] } = await client().users.conversations({
      types: conversationTypes,
      limit: 200,
    });
    const channel = channels.find((c) => !c.is_im && !c.is_mpim);
    const dm = channels.find((c) => c.is_im);
    const groupDm = channels.find((c) => c.is_mpim);

    /** The fields of a conversation's `conversations.info` record. */
    async function info(id: string) {
      return (await client().conversations.info({ channel: id })).channel as
        Record<string, unknown> | undefined;
    }

    if (channel?.id) {
      expect((await info(channel.id))?.last_read).toMatch(/^\d+\.\d+$/);
    }

    if (dm?.id) {
      const record = await info(dm.id);

      expect(record?.last_read).toMatch(/^\d+\.\d+$/);
      expect(record?.unread_count_display).toBeNumber();
    }

    // Group DMs carry no unread count (verified on a real workspace), so the
    // startup check reads their newest message instead.
    if (groupDm?.id) {
      const record = await info(groupDm.id);

      expect(record?.last_read).toMatch(/^\d+\.\d+$/);
      expect(record?.unread_count_display).toBeUndefined();
    }
  });

  test("conversations.open for your own ID answers with the existing self-DM and sends nothing", async () => {
    const auth = await client().auth.test();
    const response = await client().conversations.open({
      users: auth.user_id!,
    });

    expect(response.ok).toBe(true);
    expect(response.channel?.id).toMatch(/^D/);

    const opened = convertOpenedDirectMessage(response, auth.user_id!);

    expect(opened).toEqual({
      id: response.channel!.id!,
      kind: "im",
      isArchived: false,
      isMember: true,
      userId: auth.user_id!,
      name: undefined,
      updated: undefined,
    });
  });

  test("conversations.list lists public channels with the fields termslack reads, and pages with the cursor", async () => {
    const first = await client().conversations.list({
      types: "public_channel",
      exclude_archived: true,
      limit: 5,
    });

    expect(first.ok).toBe(true);
    expect(Array.isArray(first.channels)).toBe(true);
    expect(typeof first.response_metadata?.next_cursor).toMatch(
      /^(string|undefined)$/,
    );

    for (const channel of first.channels ?? []) {
      expect(channel.id).toBeString();
      expect(channel.name).toBeString();
      expect(channel.is_member).toBeBoolean();
      expect(channel.is_archived).toBe(false);
      expect(channel.is_private).toBe(false);

      if (channel.num_members !== undefined) {
        expect(channel.num_members).toBeNumber();
      }
    }

    const page = convertPublicChannelsPage(first);

    expect(page.issues).toEqual([]);
    expect(page.conversations).toHaveLength(first.channels?.length ?? 0);

    const cursor = first.response_metadata?.next_cursor;

    if (!cursor) {
      return;
    }

    const second = await client().conversations.list({
      types: "public_channel",
      exclude_archived: true,
      limit: 5,
      cursor,
    });

    expect(second.ok).toBe(true);
    expect(second.channels?.[0]?.id).not.toBe(first.channels?.[0]?.id);
  });

  test("conversations.join on a public channel you are already in answers with the channel and an already_in_channel warning, changing nothing", async () => {
    const { channels = [] } = await client().users.conversations({
      types: "public_channel",
      exclude_archived: true,
      limit: 20,
    });
    const member = channels.find((channel) => channel.id && channel.name);

    if (!member?.id) {
      return;
    }

    const response = await client().conversations.join({ channel: member.id });

    expect(response.ok).toBe(true);
    expect(response.warning).toBe("already_in_channel");
    expect(response.channel?.id).toBe(member.id);
    expect(response.channel?.name).toBe(member.name);
    expect(response.channel?.is_member).toBe(true);

    expect(convertJoinedChannel(response)).toMatchObject({
      id: member.id,
      kind: "channel",
      name: member.name,
      isMember: true,
      isArchived: false,
    });
  });
});
