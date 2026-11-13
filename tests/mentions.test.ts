import { expect, test } from "bun:test";
import type { Conversation, User } from "../src/session/events";
import {
  addMention,
  completionEntries,
  fromSlackText,
  type MentionDirectory,
  toSlackText,
} from "../src/session/mentions";

const user = (id: string, fields: Partial<User> = {}): User => ({
  id,
  ...fields,
});
const channel = (
  id: string,
  name: string,
  fields: Partial<Conversation> = {},
): Conversation => ({
  id,
  kind: "channel",
  name,
  isArchived: false,
  isMember: true,
  ...fields,
});

const directory: MentionDirectory = {
  users: [
    user("U1", { name: "tim", realName: "Tim Walker", displayName: "tim" }),
    user("U2", { name: "ada", realName: "Ada Lovelace", displayName: "" }),
    user("U3", { name: "sam.a", realName: "Sam A", displayName: "Sam" }),
    user("U4", { name: "sam.b", realName: "Sam B", displayName: "Sam" }),
    user("U5", { name: "gone", realName: "Gone Gary", isDeleted: true }),
  ],
  userGroups: [{ id: "S1", handle: "engineering", name: "Engineers" }],
  conversations: [
    channel("C1", "general"),
    channel("C2", "random"),
    channel("C3", "old", { isArchived: true }),
    channel("C4", "dup"),
    channel("C5", "dup"),
    { id: "D1", kind: "im", userId: "U2", isArchived: false, isMember: true },
  ],
};

test("a hand-typed handle becomes a mention when exactly one person has it", () => {
  expect(toSlackText("hi @tim and @ada!", directory)).toBe(
    "hi <@U1> and <@U2>!",
  );
  expect(toSlackText("@Tim @TimWalker @sam.a", directory)).toBe(
    "<@U1> <@U1> <@U3>",
  );
});

test("ambiguous, unknown and deleted names stay plain text", () => {
  expect(toSlackText("@Sam @nobody @gone", directory)).toBe(
    "@Sam @nobody @gone",
  );
});

test("broadcasts, user groups and channels get Slack's syntax", () => {
  expect(toSlackText("@here @channel @everyone", directory)).toBe(
    "<!here> <!channel> <!everyone>",
  );
  expect(toSlackText("ping @engineering in #general", directory)).toBe(
    "ping <!subteam^S1> in <#C1>",
  );
  expect(toSlackText("#random, #dup #missing", directory)).toBe(
    "<#C2>, #dup #missing",
  );
});

test("an archived channel still links when it is the only one with the name", () => {
  expect(toSlackText("#old", directory)).toBe("<#C3>");
});

test("email addresses and code are left alone, and the rest is still escaped", () => {
  expect(toSlackText("mail ada@tim.com now", directory)).toBe(
    "mail ada@tim.com now",
  );
  expect(
    toSlackText("`@tim` and ```\n@ada #general\n``` @tim", directory),
  ).toBe("`@tim` and ```\n@ada #general\n``` <@U1>");
  expect(toSlackText("a < b & @tim > c", directory)).toBe(
    "a &lt; b &amp; <@U1> &gt; c",
  );
});

test("without a directory the text is only escaped", () => {
  expect(toSlackText("<@U1> & @tim")).toBe("&lt;@U1&gt; &amp; @tim");
});

test("a completed mention keeps the ID that was picked even if the name is ambiguous", () => {
  const picks = addMention("", [], { label: "@Sam", slack: "<@U4>" });

  expect(toSlackText("hi @Sam", directory, picks)).toBe("hi <@U4>");
});

test("picks are used in the order the labels appear, and typed ones stay unique-only", () => {
  const picks = [
    { label: "@Sam", slack: "<@U3>" },
    { label: "@Sam", slack: "<@U4>" },
  ];

  expect(toSlackText("@Sam then @Sam then @Sam", directory, picks)).toBe(
    "<@U3> then <@U4> then @Sam",
  );
});

test("adding a mention forgets picks whose text was deleted", () => {
  const first = addMention("", [], { label: "@Sam", slack: "<@U3>" });
  const second = addMention("", first, { label: "@Sam", slack: "<@U4>" });

  expect(second).toEqual([{ label: "@Sam", slack: "<@U4>" }]);
});

test("completion lists people, groups and broadcasts for @, ranked by prefix", () => {
  const labels = (query: string) =>
    completionEntries(directory, "@", query).map((entry) => entry.label);

  expect(labels("t")).toEqual(["@tim"]);
  expect(labels("lo")).toEqual(["@ada"]);
  expect(labels("e").slice(0, 2)).toEqual(["@engineering", "@everyone"]);
  expect(labels("ch")).toEqual(["@channel"]);
  expect(labels("gone")).toEqual([]);
});

test("an empty query shows the broadcasts first and at most six entries", () => {
  const entries = completionEntries(directory, "@", "");

  expect(entries).toHaveLength(6);
  expect(entries.slice(0, 3).map((entry) => entry.label)).toEqual([
    "@here",
    "@channel",
    "@everyone",
  ]);
});

test("a completion for an ambiguous name inserts a handle that stays unique when there is one", () => {
  const entries = completionEntries(directory, "@", "sam");

  expect(entries.map((entry) => [entry.label, entry.slack])).toEqual([
    ["@sam.a", "<@U3>"],
    ["@sam.b", "<@U4>"],
  ]);
});

test("completion for # puts channels you are in first and skips DMs", () => {
  const dir: MentionDirectory = {
    ...directory,
    conversations: [
      channel("C8", "ops-alerts", { isMember: false }),
      channel("C9", "ops"),
      ...directory.conversations,
    ],
  };

  expect(completionEntries(dir, "#", "op").map((entry) => entry.slack)).toEqual(
    ["<#C9>", "<#C8>"],
  );
  expect(
    completionEntries(dir, "#", "").some((entry) => entry.slack === "<#D1>"),
  ).toBe(false);
});

test("Slack text turns back into editable text, with the mentions that keep their IDs", () => {
  const edited = fromSlackText(
    "hi <@U4> and <@U1|tim> in <#C1|general>, <!subteam^S1|@engineering> <!here> a &lt; b &amp; &gt;",
    directory,
  );

  expect(edited.text).toBe(
    "hi @sam.b and @tim in #general, @engineering @here a < b & >",
  );
  expect(toSlackText(edited.text, directory, edited.mentions)).toBe(
    "hi <@U4> and <@U1> in <#C1>, <!subteam^S1> <!here> a &lt; b &amp; &gt;",
  );
});

test("unknown people and channels keep their IDs when edited and sent again", () => {
  const edited = fromSlackText(
    "<@U99> <#C99|gone> <https://a.b/c|link>",
    directory,
  );

  expect(edited.text).toBe("@U99 #gone https://a.b/c");
  expect(toSlackText(edited.text, directory, edited.mentions)).toBe(
    "<@U99> <#C99> https://a.b/c",
  );
});
