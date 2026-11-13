import { describe, expect, test } from "bun:test";
import { slackClient } from "../../src/slack/client";
import { conversationTypes } from "../../src/slack/conversations";

/**
 * Talks to real Slack as you. Skipped unless TERMSLACK_USER_TOKEN is set; `bun run
 * test:live` fills it in from your stored workspace. Asserts the response
 * shapes termslack relies on, never exact data. Reads only.
 */
const userToken = process.env.TERMSLACK_USER_TOKEN;

describe.skipIf(!userToken)("live Slack history", () => {
  const client = () => slackClient(userToken);

  /** The first conversation of yours with at least one message, and that page of history. */
  async function someHistory() {
    const { channels = [] } = await client().users.conversations({
      types: conversationTypes,
      limit: 20,
    });

    for (const { id } of channels) {
      if (!id) {
        continue;
      }

      const history = await client()
        .conversations.history({ channel: id, limit: 20 })
        .catch(() => undefined);

      if (history?.messages?.length) {
        return { channel: id, history };
      }
    }

    return undefined;
  }

  test("conversations.history returns messages newest first with the fields termslack reads", async () => {
    const found = await someHistory();

    if (!found) {
      return;
    }

    const {
      messages = [],
      has_more: hasMore,
      response_metadata,
    } = found.history;

    expect(found.history.ok).toBe(true);
    expect(hasMore).toBeBoolean();
    expect(typeof response_metadata?.next_cursor).toMatch(
      /^(string|undefined)$/,
    );

    for (const message of messages) {
      expect(message.ts).toMatch(/^\d+\.\d+$/);
      expect(
        message.text === undefined || typeof message.text === "string",
      ).toBe(true);

      if (message.reply_count !== undefined) {
        expect(message.reply_count).toBeNumber();
        expect(message.thread_ts).toBeString();
      }
    }

    const stamps = messages.map((message) => Number(message.ts));

    expect(stamps).toEqual([...stamps].sort((a, b) => b - a));
  });

  test("conversations.history pages with the cursor", async () => {
    const found = await someHistory();
    const cursor = found?.history.response_metadata?.next_cursor;

    if (!found || !cursor) {
      return;
    }

    const next = await client().conversations.history({
      channel: found.channel,
      limit: 20,
      cursor,
    });

    expect(next.ok).toBe(true);
    expect(next.messages?.[0]?.ts).not.toBe(found.history.messages?.[0]?.ts);
  });

  test("conversations.replies starts with the parent and carries thread fields", async () => {
    const found = await someHistory();
    const parent = found?.history.messages?.find(
      (message) => (message.reply_count ?? 0) > 0,
    );

    if (!found || !parent?.ts) {
      return;
    }

    const replies = await client().conversations.replies({
      channel: found.channel,
      ts: parent.ts,
      limit: 20,
    });

    expect(replies.ok).toBe(true);
    expect(replies.messages?.[0]?.ts).toBe(parent.ts);
    expect(typeof replies.response_metadata?.next_cursor).toMatch(
      /^(string|undefined)$/,
    );

    for (const message of replies.messages ?? []) {
      expect(message.ts).toBeString();
      expect(message.thread_ts).toBe(parent.ts);
    }
  });

  test("attachments and Block Kit blocks have the shapes termslack reads", async () => {
    const found = await someHistory();
    const messages = found?.history.messages ?? [];
    const attachments = messages.flatMap(
      (message) => message.attachments ?? [],
    );
    const blocks = messages.flatMap((message) => message.blocks ?? []);

    for (const attachment of attachments) {
      for (const field of [
        "fallback",
        "pretext",
        "author_name",
        "author_link",
        "title",
        "title_link",
        "text",
        "footer",
        "image_url",
        "thumb_url",
        "color",
      ] as const) {
        expect(
          attachment[field] === undefined ||
            typeof attachment[field] === "string",
        ).toBe(true);
      }

      expect(
        attachment.ts === undefined || typeof attachment.ts === "number",
      ).toBe(true);

      for (const field of attachment.fields ?? []) {
        expect(
          field.title === undefined || typeof field.title === "string",
        ).toBe(true);
        expect(
          field.value === undefined || typeof field.value === "string",
        ).toBe(true);
        expect(
          field.short === undefined || typeof field.short === "boolean",
        ).toBe(true);
      }
    }

    for (const block of blocks) {
      expect(block.type).toBeString();
    }
  });

  test("history messages with reactions carry name, users and count", async () => {
    const found = await someHistory();
    const reacted = found?.history.messages?.filter(
      (message) => (message.reactions?.length ?? 0) > 0,
    );

    if (!reacted?.length) {
      return;
    }

    for (const message of reacted) {
      for (const reaction of message.reactions ?? []) {
        expect(reaction.name).toBeString();
        expect(reaction.count).toBeNumber();
        expect(reaction.users).toBeArray();

        for (const user of reaction.users ?? []) {
          expect(user).toBeString();
        }

        // `users` may be shorter than `count`, never longer
        expect(reaction.users?.length ?? 0).toBeLessThanOrEqual(
          reaction.count ?? 0,
        );
      }
    }
  });

  test("rich_text blocks carry the element, list and style fields termslack reads", async () => {
    const found = await someHistory();
    const blocks = (found?.history.messages ?? []).flatMap((message) =>
      (message.blocks ?? []).filter((block) => block.type === "rich_text"),
    );

    for (const block of blocks) {
      for (const container of (block as any).elements ?? []) {
        expect([
          "rich_text_section",
          "rich_text_list",
          "rich_text_preformatted",
          "rich_text_quote",
        ]).toContain(container.type);
        expect(container.elements).toBeArray();

        if (container.type === "rich_text_list") {
          expect(["ordered", "bullet"]).toContain(container.style);
          expect(container.indent ?? 0).toBeNumber();
        }

        for (const element of container.elements) {
          if (element.style !== undefined) {
            expect(typeof element.style).toBe("object");
            expect(
              Object.values(element.style).every(
                (flag) => typeof flag === "boolean",
              ),
            ).toBe(true);
          }
        }
      }
    }
  });
});

describe.skipIf(!userToken)("live Slack public channel history", () => {
  const client = () => slackClient(userToken);

  test("a public channel the user isn't in either answers history or refuses with a code termslack words", async () => {
    const { channels = [] } = await client().conversations.list({
      types: "public_channel",
      exclude_archived: true,
      limit: 200,
    });
    const notJoined = channels.find(
      (channel) => channel.id && !channel.is_member,
    );

    if (!notJoined?.id) {
      return;
    }

    const answer = await client()
      .conversations.history({ channel: notJoined.id, limit: 5 })
      .then(
        (history) => ({
          ok: history.ok,
          messages: history.messages,
          error: undefined as string | undefined,
        }),
        (error: { data?: { error?: string } }) => ({
          ok: false,
          messages: undefined,
          error: error.data?.error,
        }),
      );

    if (answer.ok) {
      expect(Array.isArray(answer.messages)).toBe(true);
      return;
    }

    expect(["not_in_channel", "channel_not_found", "missing_scope"]).toContain(
      answer.error ?? "",
    );
  });

  test("history pages with different limits share one cursor chain, newest first and without overlap", async () => {
    const { channels = [] } = await client().users.conversations({
      types: "public_channel",
      limit: 20,
    });

    for (const { id } of channels) {
      if (!id) {
        continue;
      }

      const first = await client()
        .conversations.history({ channel: id, limit: 2 })
        .catch(() => undefined);
      const cursor = first?.response_metadata?.next_cursor;

      if (!first?.has_more || !cursor) {
        continue;
      }

      const second = await client().conversations.history({
        channel: id,
        limit: 200,
        cursor,
      });
      const seen = new Set((first.messages ?? []).map((message) => message.ts));

      for (const message of second.messages ?? []) {
        expect(seen.has(message.ts)).toBe(false);
        expect(Number(message.ts)).toBeLessThan(
          Number(first.messages?.at(-1)?.ts),
        );
      }

      return;
    }
  });
});
