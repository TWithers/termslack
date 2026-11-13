import { describe, expect, test } from "bun:test";
import { slackClient } from "../../src/slack/client";
import { conversationTypes } from "../../src/slack/conversations";

/**
 * Talks to real Slack as you. Skipped unless TERMSLACK_USER_TOKEN is set; `bun run
 * test:live` fills it in from your stored workspace. Asserts the response
 * shapes termslack relies on, never exact data.
 */
const userToken = process.env.TERMSLACK_USER_TOKEN;

describe.skipIf(!userToken)("live Slack people", () => {
  const client = () => slackClient(userToken);

  function expectProfileShape(user: Record<string, any>) {
    expect(user.id).toBeString();
    expect(user.name).toBeString();
    expect(user.deleted).toBeBoolean();
    expect(user.profile).toBeObject();
    expect(user.profile.display_name).toBeString();
    expect(user.profile.real_name).toBeString();
    expect(user.profile.status_text).toBeString();
    expect(user.profile.status_emoji).toBeString();
  }

  test("users.info describes a user with the fields termslack reads", async () => {
    const auth = await client().auth.test();
    const { ok, user } = await client().users.info({ user: auth.user_id! });

    expect(ok).toBe(true);
    expect(user?.id).toBe(auth.user_id);
    expectProfileShape(user!);
    expect(user?.is_bot).toBeBoolean();
  });

  test("users.info reports an unknown user as user_not_found", async () => {
    const error = await client()
      .users.info({ user: "U0000000000" })
      .catch((caught) => caught);

    expect(error.data?.error).toBe("user_not_found");
  });

  test("users.list lists people with the fields termslack reads", async () => {
    const response = await client().users.list({ limit: 50 });

    expect(response.ok).toBe(true);
    expect(Array.isArray(response.members)).toBe(true);
    expect(response.members?.length).toBeGreaterThan(0);
    expect(typeof response.response_metadata?.next_cursor).toMatch(
      /^(string|undefined)$/,
    );

    for (const member of response.members ?? []) {
      expectProfileShape(member);
    }
  });

  test("users.list members carry a hex colour", async () => {
    const response = await client().users.list({ limit: 50 });
    const coloured = (response.members ?? []).filter(
      (member: Record<string, any>) => member.color !== undefined,
    );

    if (coloured.length === 0) {
      return;
    }

    for (const member of coloured) {
      expect((member as Record<string, any>).color).toMatch(/^[0-9a-fA-F]{6}$/);
    }
  });

  test("users.list pages with the cursor", async () => {
    const first = await client().users.list({ limit: 1 });
    const cursor = first.response_metadata?.next_cursor;

    if (!cursor) {
      return;
    }

    const second = await client().users.list({ limit: 1, cursor });

    expect(second.ok).toBe(true);
    expect(second.members?.[0]?.id).not.toBe(first.members?.[0]?.id);
  });

  test("bots.info describes a bot with the fields termslack reads", async () => {
    const { members } = await client().users.list({ limit: 200 });
    const botUser = members?.find((member) => member.is_bot && !member.deleted);
    const botId = botUser?.profile?.bot_id;

    if (!botId) {
      return;
    }

    const { ok, bot } = await client().bots.info({ bot: botId });

    expect(ok).toBe(true);
    expect(bot?.id).toBe(botId);
    expect(bot?.name).toBeString();
  });

  test("bots.info reports an unknown bot as bot_not_found", async () => {
    const error = await client()
      .bots.info({ bot: "B0000000000" })
      .catch((caught) => caught);

    expect(error.data?.error).toBe("bot_not_found");
  });

  test("conversations.members lists a group DM's members as user IDs", async () => {
    const { channels } = await client().users.conversations({
      types: conversationTypes
        .split(",")
        .filter((type) => type === "mpim")
        .join(","),
      limit: 1,
    });
    const id = channels?.[0]?.id;

    if (!id) {
      return;
    }

    const response = await client().conversations.members({
      channel: id,
      limit: 100,
    });

    expect(response.ok).toBe(true);
    expect(Array.isArray(response.members)).toBe(true);
    expect(response.members?.length).toBeGreaterThan(1);

    for (const member of response.members ?? []) {
      expect(member).toBeString();
    }
  });

  test("usergroups.list lists groups with the fields termslack reads", async () => {
    const response = await client().usergroups.list();

    expect(response.ok).toBe(true);
    expect(Array.isArray(response.usergroups)).toBe(true);

    for (const group of response.usergroups ?? []) {
      expect(group.id).toMatch(/^S/);
      expect(group.handle).toBeString();
      expect(group.name).toBeString();
    }
  });

  test("usergroups.list with include_users lists each group's members as user IDs", async () => {
    const response = await client().usergroups.list({ include_users: true });

    expect(response.ok).toBe(true);

    for (const group of response.usergroups ?? []) {
      expect(Array.isArray(group.users)).toBe(true);

      for (const member of group.users ?? []) {
        expect(member).toMatch(/^[UW]/);
      }
    }
  });
});
