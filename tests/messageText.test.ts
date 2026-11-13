import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
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

/** The text of the last logged message line, after the author. */
const lastText = () =>
  plain(lines.at(-1) ?? "").replace(/^.*? message +\S+ \S+: /, "");

const callsTo = (method: string) =>
  harness.slack.calls.filter((call) => call.method === method);

const callsFor = (method: string, param: string, id: string) =>
  callsTo(method).filter((call) => call.params[param] === id);

async function userResponse(id: string, displayName: string) {
  const [response] = await loadFixture("users-info");

  return {
    ...response,
    user: {
      ...response?.user,
      id,
      profile: { ...response?.user.profile, display_name: displayName },
    },
  };
}

/** A session that has loaded the channels and DMs, where U222222222 is "egon" and U333333333 doesn't exist. */
async function startLoaded(
  options: Parameters<typeof startSessionHarness>[0] = {},
) {
  const pages = [
    ...(await loadFixture("users-conversations-channels")),
    ...(await loadFixture("users-conversations-dms")),
  ];
  const egon = await userResponse("U222222222", "egon");

  harness = await startSessionHarness({
    ...options,
    prepare(slack) {
      slack.respond("users.info", (call) =>
        call.params.user === "U222222222"
          ? egon
          : { ok: false, error: "user_not_found" },
      );
      slack.respond(
        "usergroups.list",
        async () => (await loadFixture("usergroups-list"))[0]!,
      );
      slack.respondPaged("users.conversations", pages);
      options.prepare?.(slack);
    },
  });

  logSession(harness.session, false);

  await waitFor(() => harness.session.conversation("D0BSHH4AD"));
}

function message(text: string, ts = "1355517523.000005") {
  return {
    event: {
      type: "message",
      channel: "C012AB3CD",
      user: "U123ABC456",
      text,
      ts,
      channel_type: "channel",
    },
  };
}

/** Sends a message and returns what the log printed for its text. */
async function shown(text: string): Promise<string> {
  await harness.sendEvents(message(text));

  return lastText();
}

const recorded: [string, string, string][] = [
  ["a user mention", "hi <@U222222222>!", "hi @egon!"],
  ["a user mention with a label", "hi <@U999999999|zed>", "hi @zed"],
  ["an unresolvable user mention", "hi <@U333333333>", "hi @U333333333"],
  ["a channel mention", "see <#C061EG9T2>", "see #random"],
  [
    "a channel mention with a label",
    "see <#C0UNKNOWN1|elsewhere>",
    "see #elsewhere",
  ],
  ["an unknown channel mention", "see <#C0UNKNOWN1>", "see #C0UNKNOWN1"],
  ["a DM mention", "in <#D0C0F7S8Y>", "in @egon"],
  ["@here", "<!here> standup", "@here standup"],
  ["@here with a label", "<!here|here> standup", "@here standup"],
  ["@channel", "<!channel> heads up", "@channel heads up"],
  ["@everyone", "<!everyone>", "@everyone"],
  ["a user group", "ping <!subteam^S0615G0KT>", "ping @marketing-team"],
  [
    "a user group with a label",
    "ping <!subteam^S0999999999|@oncall>",
    "ping @oncall",
  ],
  ["an unknown user group", "ping <!subteam^S0999999999>", "ping @S0999999999"],
  [
    "a bare link",
    "<https://example.com/a?b=1&amp;c=2>",
    "https://example.com/a?b=1&c=2",
  ],
  [
    "a labelled link",
    "read <https://example.com|the docs> now",
    "read the docs (https://example.com) now",
  ],
  [
    "a mailto link",
    "<mailto:bob@example.com|bob@example.com>",
    "bob@example.com (mailto:bob@example.com)",
  ],
  [
    "a bare mailto link",
    "<mailto:bob@example.com>",
    "bob@example.com (mailto:bob@example.com)",
  ],
  ["entities", "1 &lt; 2 &amp;&amp; 3 &gt; 2", "1 < 2 && 3 > 2"],
  ["an entity that isn't decoded twice", "&amp;lt;", "&lt;"],
  [
    "a date with a fallback",
    "at <!date^1392734382^{date_num} {time}|Feb 18, 2014>",
    "at Feb 18, 2014",
  ],
  ["a comparison that isn't markup", "a < b and c > d", "a < b and c > d"],
];

const malformed: [string, string][] = [
  ["an unclosed mention", "oops <@U222222222"],
  ["a lone opening bracket", "x <"],
  ["an unknown command", "<!foo>"],
  ["an unknown command with a label", "<!foo|bar>"],
  ["a date without a fallback", "<!date^1392734382^{date_num}>"],
  ["empty markup", "<>"],
  ["words in brackets", "<just some words>"],
  ["a lowercase user ID", "<@u lower>"],
  ["a user group without an ID", "<!subteam^>"],
  ["a stray closing bracket", "a > b <3"],
];

test.each(recorded)("renders %s", async (_name, text, expected) => {
  await startLoaded();

  expect(await shown(text)).toBe(expected);
});

test.each(malformed)("shows %s as sent", async (_name, text) => {
  await startLoaded();

  expect(await shown(text)).toBe(text);
});

test("segments say what each piece is", async () => {
  await startLoaded();
  await shown("<@U222222222> <#C061EG9T2> <!subteam^S0615G0KT>");

  expect(
    renderMessageText(
      "<@U222222222> <#C061EG9T2> <!here> <!subteam^S0615G0KT> <https://x.test|x> hi &amp;",
      harness.session,
    ),
  ).toEqual([
    { kind: "user", text: "@egon", userId: "U222222222" },
    { kind: "text", text: " " },
    { kind: "channel", text: "#random", conversationId: "C061EG9T2" },
    { kind: "text", text: " " },
    { kind: "broadcast", text: "@here", target: "here" },
    { kind: "text", text: " " },
    { kind: "userGroup", text: "@marketing-team", userGroupId: "S0615G0KT" },
    { kind: "text", text: " " },
    { kind: "link", text: "x", url: "https://x.test" },
    { kind: "text", text: " hi &" },
  ]);
});

test("rendering never throws, whatever the text", () => {
  for (const text of [
    "",
    "<",
    ">",
    "<<<>>>",
    "<@>",
    "<!>",
    "&",
    "<#|>",
    "<|>",
  ]) {
    expect(() => renderMessageText(text)).not.toThrow();
  }
});

test("mentions are looked up once, before the message is shown", async () => {
  await startLoaded();

  const text = await shown(
    "<@U222222222> <@U222222222> <!subteam^S0615G0KT> <!subteam^S0615G0KT> <#C0UNKNOWN1>",
  );

  expect(text).toBe("@egon @egon @marketing-team @marketing-team #C0UNKNOWN1");
  expect(callsFor("users.info", "user", "U222222222")).toHaveLength(1);
  expect(callsTo("usergroups.list")).toHaveLength(1);
  expect(callsFor("conversations.info", "channel", "C0UNKNOWN1")).toHaveLength(
    1,
  );
  expect(harness.session.userGroup("S0615G0KT")?.handle).toBe("marketing-team");
  expect(harness.session.userGroup("S0614TZR7")?.handle).toBe("admins");
});

test("a mentioned channel that wasn't loaded is looked up", async () => {
  await startLoaded({
    prepare: (slack) =>
      slack.respond("conversations.info", async (call) =>
        call.params.channel === "C0UNKNOWN1"
          ? {
              ok: true,
              channel: {
                ...(await loadPayload("conversations-info-channel")).channel,
                id: "C0UNKNOWN1",
                name: "project-x",
              },
            }
          : { ok: false, error: "channel_not_found" },
      ),
  });

  expect(await shown("see <#C0UNKNOWN1|stale-label>")).toBe("see #project-x");
});

test("unresolvable mentions are remembered and not asked for again", async () => {
  await startLoaded();

  await shown("<@U333333333> <!subteam^S0999999999>");

  const groupListings = callsTo("usergroups.list").length;

  await shown("<@U333333333> <!subteam^S0999999999>");

  expect(callsFor("users.info", "user", "U333333333")).toHaveLength(1);
  expect(callsTo("usergroups.list")).toHaveLength(groupListings);
});

test("a failed user-group lookup uses the label, and is retried next time", async () => {
  let failing = true;

  await startLoaded({
    prepare: (slack) =>
      slack.respond("usergroups.list", async () =>
        failing
          ? { ok: false, error: "ratelimited" }
          : (await loadFixture("usergroups-list"))[0]!,
      ),
  });

  expect(await shown("<!subteam^S0615G0KT|@marketing>")).toBe("@marketing");

  failing = false;

  expect(await shown("<!subteam^S0615G0KT|@marketing>")).toBe(
    "@marketing-team",
  );
});

test("a missing usergroups scope shows IDs, once, without breaking the message", async () => {
  await startLoaded({
    prepare: (slack) =>
      slack.respond("usergroups.list", () => ({
        ok: false,
        error: "missing_scope",
      })),
  });

  expect(await shown("<!subteam^S0615G0KT> hi")).toBe("@S0615G0KT hi");

  const groupListings = callsTo("usergroups.list").length;

  expect(await shown("<!subteam^S0615G0KT> hi")).toBe("@S0615G0KT hi");
  expect(callsTo("usergroups.list")).toHaveLength(groupListings);
});

test("renaming a channel or user changes how later messages render mentions", async () => {
  await startLoaded();

  expect(await shown("<#C012AB3CD> <@U222222222>")).toBe("#general @egon");

  await harness.sendEvents(await loadPayload("channel-rename"));
  await harness.sendEvents({
    event: {
      type: "user_change",
      user: { id: "U222222222", profile: { display_name: "peter" } },
      event_ts: "1.1",
    },
  });

  expect(await shown("<#C012AB3CD> <@U222222222>")).toBe("#renamed @peter");
});

test("edited messages render their mentions too", async () => {
  await startLoaded();

  await harness.sendEvents({
    event: {
      type: "message",
      subtype: "message_changed",
      channel: "C012AB3CD",
      message: {
        user: "U123ABC456",
        text: "now <@U222222222> &amp; <!here>",
        ts: "1.1",
      },
      ts: "2.2",
    },
  });

  expect(plain(lines.at(-1) ?? "")).toMatch(/edited: now @egon & @here$/);
});

test("an event is published with raw IDs when the lookups take too long", async () => {
  let release = () => {};
  let answered = false;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  await startLoaded({
    nameWaitMs: 20,
    prepare: (slack) =>
      slack.respond("users.info", async () => {
        await gate;
        answered = true;

        return { ok: false, error: "user_not_found" };
      }),
  });

  expect(await shown("hi <@U555555555>")).toBe("hi @U555555555");

  release();
  await waitFor(() => answered);
});
