import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { emojiCompletions, reactionName } from "../src/session/emoji";
import { renderMessageText } from "../src/session/messageText";
import { logSession } from "../src/ui/eventLog";
import { waitFor } from "./support/fakeSlack";
import { loadFixture, loadPayload } from "./support/fixtures";
import {
  type SessionHarness,
  startSessionHarness,
} from "./support/sessionHarness";

let harness: SessionHarness;
let lines: string[];
let spy: ReturnType<typeof spyOn>;

beforeEach(() => {
  lines = [];
  spy = spyOn(console, "log").mockImplementation((line: string) => {
    lines.push(line);
  });
});

afterEach(async () => {
  await harness.stop();
  spy.mockRestore();
});

const plain = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, "");

/** A session that has loaded the workspace's custom emoji. */
async function startLoaded() {
  const [list] = await loadFixture("emoji-list");

  harness = await startSessionHarness({
    prepare: (slack) => slack.respond("emoji.list", () => list!),
  });

  logSession(harness.session, false);
  await waitFor(() => harness.session.customEmoji("bowtie"));
}

/** Sends a message and returns what the log printed for its text. */
async function shown(text: string): Promise<string> {
  await harness.sendEvents({
    event: {
      type: "message",
      channel: "C012AB3CD",
      user: "U123ABC456",
      text,
      ts: "1355517523.000005",
      channel_type: "channel",
    },
  });

  return plain(lines.at(-1) ?? "").replace(/^.*? message +\S+ \S+: /, "");
}

const cases: [string, string, string][] = [
  ["a standard shortcode", "party :tada:!", "party 🎉!"],
  ["+1", ":+1:", "👍"],
  ["thumbsup, an alias of +1", ":thumbsup:", "👍"],
  ["simple_smile, Slack's name for a slight smile", ":simple_smile:", "🙂"],
  ["a multi-codepoint emoji", ":man-woman-girl: :us:", "👨‍👩‍👧 🇺🇸"],
  ["a skin tone", ":thumbsup::skin-tone-3:", "👍🏼"],
  ["a skin tone on an alias", ":+1::skin-tone-2:", "👍🏻"],
  ["the highest skin tone", ":wave::skin-tone-6:", "👋🏿"],
  ["a skin tone the emoji doesn't come in", ":tada::skin-tone-3:", "🎉🏼"],
  ["several in a row", ":tada::tada: :fire:", "🎉🎉 🔥"],
  ["a custom emoji", "go :bowtie:", "go :bowtie:"],
  ["an alias for a standard emoji", ":party:", "🎉"],
  [
    "an alias for a standard emoji, through another alias",
    ":thumbs_up_alias:",
    "👍",
  ],
  ["an alias for a custom emoji", ":shipit:", ":shipit:"],
  ["an unknown shortcode", ":not_an_emoji:", ":not_an_emoji:"],
  ["a time", "at 12:30:45 sharp", "at 12:30:45 sharp"],
  ["a lone colon pair", "a :: b ::: c", "a :: b ::: c"],
  ["an unknown shortcode before a known one", ":nope:tada:", ":nope🎉"],
  ["inline code", "`:tada:` is :tada:", "`:tada:` is 🎉"],
  ["a code block", "```\n:tada:\n```\n:tada:", "```\n:tada:\n```\n🎉"],
  ["an unclosed backtick", "a ` :tada:", "a ` 🎉"],
];

test.each(cases)("renders %s", async (_name, text, expected) => {
  await startLoaded();

  expect(await shown(text)).toBe(expected);
});

test("a link's URL and label are left alone", async () => {
  await startLoaded();

  expect(await shown("<https://example.com/:tada:|:tada: docs> :tada:")).toBe(
    ":tada: docs (https://example.com/:tada:) 🎉",
  );
});

test("a mention's name is left alone", async () => {
  await startLoaded();

  expect(await shown("<@U999999999|:tada:> :tada:")).toBe("@:tada: 🎉");
});

test("segments say which pieces are emoji", async () => {
  await startLoaded();

  expect(
    renderMessageText("hi :tada: :bowtie: :nope: <!here>", harness.session),
  ).toEqual([
    { kind: "text", text: "hi " },
    { kind: "emoji", text: "🎉", shortcode: ":tada:" },
    { kind: "text", text: " " },
    { kind: "emoji", text: ":bowtie:", shortcode: ":bowtie:" },
    { kind: "text", text: " :nope: " },
    { kind: "broadcast", text: "@here", target: "here" },
  ]);
});

test("edited messages show emoji too", async () => {
  await startLoaded();

  const payload = await loadPayload("message-changed");

  payload.event.message.text = "better :tada:";
  await harness.sendEvents(payload);

  expect(plain(lines.at(-1) ?? "")).toEndWith("edited: better 🎉");
});

async function reactionShown(reaction: string): Promise<string> {
  const payload = await loadPayload("reaction-added");

  payload.event.reaction = reaction;
  await harness.sendEvents(payload);

  return plain(lines.at(-1) ?? "").replace(
    /^.*? \S+ \S+ ([+-]\S+) on .*$/,
    "$1",
  );
}

test.each([
  ["thumbsup", "+👍"],
  ["+1::skin-tone-2", "+👍🏻"],
  ["bowtie", "+:bowtie:"],
  ["not_an_emoji", "+:not_an_emoji:"],
])("shows the reaction %s as %s", async (reaction, expected) => {
  await startLoaded();

  expect(await reactionShown(reaction)).toBe(expected);
});

test("shows a user's status emoji", async () => {
  await startLoaded();
  await harness.sendEvents(await loadPayload("user-status-changed"));

  expect(plain(lines.at(-1) ?? "")).toContain("status: 🌴 ");
});

test("emoji_changed keeps the custom emoji current", async () => {
  await startLoaded();

  const [add, addAlias, remove, rename] = await loadFixture("emoji-changed");

  await harness.sendEvents(add!);
  expect(harness.session.customEmoji("picard_facepalm")).toBeDefined();
  expect(plain(lines.at(-1) ?? "")).toContain("emoji added: :picard_facepalm:");

  await harness.sendEvents(addAlias!);
  expect(await shown(":engage:")).toBe("🎉");

  await harness.sendEvents(remove!);
  expect(harness.session.customEmoji("picard_facepalm")).toBeUndefined();

  await harness.sendEvents(add!);
  await harness.sendEvents(rename!);
  expect(harness.session.customEmoji("picard_facepalm")).toBeUndefined();
  expect(harness.session.customEmoji("picard_facepalm2")).toBeDefined();
  expect(plain(lines.at(-1) ?? "")).toContain(
    "emoji renamed :picard_facepalm: to :picard_facepalm2:",
  );
});

test("an emoji.list that arrives late doesn't undo a removal", async () => {
  const [list] = await loadFixture("emoji-list");
  const [, , remove] = await loadFixture("emoji-changed");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));

  harness = await startSessionHarness({
    prepare: (slack) =>
      slack.respond("emoji.list", async () => {
        await gate;

        return {
          ...list!,
          emoji: { ...list!.emoji, picard_facepalm: "https://x.test/p.gif" },
        };
      }),
  });

  await harness.sendEvents(remove!);
  release();
  await waitFor(() => harness.session.customEmoji("bowtie"));

  expect(harness.session.customEmoji("picard_facepalm")).toBeUndefined();
});

test("a failing emoji.list leaves custom emoji as shortcodes", async () => {
  harness = await startSessionHarness({
    prepare: (slack) =>
      slack.respond("emoji.list", () => ({
        ok: false,
        error: "missing_scope",
      })),
  });
  logSession(harness.session, false);

  expect(await shown(":bowtie: :tada:")).toBe(":bowtie: 🎉");
});
