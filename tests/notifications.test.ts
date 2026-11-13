import { afterEach, beforeEach, expect, test } from "bun:test";
import { seedWorkspace } from "./support/appHarness";
import { type FakeSlack, waitFor } from "./support/fakeSlack";
import { type FakeClock, fakeClock } from "./support/fakeClock";
import { loadFixture, loadPayload } from "./support/fixtures";
import {
  type SessionHarness,
  startSessionHarness,
} from "./support/sessionHarness";
import { notificationIntervalMs } from "../src/session/notifications";
import { convertDndStatus, convertEnvelope } from "../src/slack/convert";

let harness: SessionHarness;
let clock: FakeClock;

const me = "U123ABC456";
const other = "U222222222";
const general = "C012AB3CD";
const random = "C061EG9T2";
const directMessage = "D0C0F7S8Y";
const marketing = "S0615G0KT";

let counter = 0;

beforeEach(() => {
  clock = fakeClock();
});

type DndFields = {
  dnd_enabled: boolean;
  next_dnd_start_ts?: number;
  next_dnd_end_ts?: number;
  snooze_enabled?: boolean;
  snooze_endtime?: number;
};

const idle: DndFields = { dnd_enabled: false, snooze_enabled: false };

/** Seconds since the epoch, `offsetSeconds` from the fake clock's now. */
const at = (offsetSeconds: number) =>
  Math.floor(clock.now() / 1000) + offsetSeconds;

async function start({
  dnd = idle as DndFields | Error,
  groups = {} as Record<string, string[]>,
  prepare,
  windowMs,
  intervalMs,
  readsDnd = true,
}: {
  dnd?: DndFields | Error;
  groups?: Record<string, string[]>;
  prepare?: (slack: FakeSlack) => void;
  windowMs?: number;
  intervalMs?: number;
  /** Whether termslack is expected to call `dnd.info`. */
  readsDnd?: boolean;
} = {}) {
  harness = await startSessionHarness({
    clock,
    notificationWindowMs: windowMs,
    notificationIntervalMs: intervalMs,
    prepare: (slack) => {
      slack.respond("dnd.info", () =>
        dnd instanceof Error
          ? { ok: false, error: "fatal_error" }
          : { ok: true, ...dnd },
      );
      slack.respond("usergroups.list", () => ({
        ok: true,
        usergroups: Object.entries(groups).map(([id, users]) => ({
          id,
          handle: `handle-${id.toLowerCase()}`,
          name: `Group ${id}`,
          users,
        })),
      }));
      prepare?.(slack);
    },
  });
  await waitFor(() => harness.session.currentUserId);
  await waitFor(
    () =>
      !readsDnd ||
      harness.slack.calls.some((call) => call.method === "dnd.info"),
  );
  await Bun.sleep(30);
}

afterEach(() => harness.stop());

/** Sends a message event and waits until the session has published it. */
function say(
  channel: string,
  overrides: Record<string, unknown> = {},
  channelType = "channel",
) {
  counter += 1;

  return harness.sendEvents({
    event: {
      type: "message",
      channel,
      channel_type: channelType,
      user: other,
      text: "hello there",
      ts: `1700000000.${String(counter).padStart(6, "0")}`,
      ...overrides,
    },
  });
}

const mentionMe = { text: `hey <@${me}>` };

/** Lets the gathering window end, so what was waiting is sent. */
const flush = () => clock.advance(1000);

const notified = () => harness.notifications;

const dndCalls = () =>
  harness.slack.calls.filter((call) => call.method === "dnd.info");

test("a mention of the user notifies, with what 09 needs to describe it", async () => {
  await start();

  await say(general, { text: `hey <@${me}> *look*  at\nthis` });
  flush();

  expect(notified()).toHaveLength(1);
  expect(notified()[0]).toMatchObject({
    count: 1,
    isBurst: false,
    newest: {
      conversationId: general,
      conversationKind: "channel",
      userId: other,
      text: expect.stringContaining("look at this"),
    },
  });
  expect(notified()[0]!.messages).toEqual([notified()[0]!.newest]);
});

test("the text is plain: formatting stripped, mentions by name rather than ID", async () => {
  await start({
    prepare: (slack) =>
      slack.respond("users.info", () => ({
        ok: true,
        user: { id: me, name: "tim", profile: { display_name: "tim" } },
      })),
  });

  await say(general, { text: `hey <@${me}> *look*` });
  flush();

  expect(notified()[0]!.newest.text).toBe("hey @tim look");
});

test("user group, @here, @channel and @everyone mentions notify; plain talk doesn't", async () => {
  await start({ groups: { [marketing]: [me] } });

  await say(general, { text: `<!subteam^${marketing}> meeting` });
  await say(general, { text: "<!here> standup" });
  await say(general, { text: "<!channel> hi" });
  await say(general, { text: "<!everyone> hi" });
  flush();

  expect(notified()[0]!.count).toBe(4);

  await say(general, { text: "just talking" });
  await say(general, { text: "<@U333333333> look" });
  await say(general, { text: "<!subteam^S0614TZR7> not mine" });
  flush();

  expect(notified()).toHaveLength(1);
});

test("a DM or group DM notifies whatever it says", async () => {
  await start();

  await say(directMessage, { text: "lunch?" }, "im");
  flush();
  await say("G0AKFJBEU", { text: "morning" }, "mpim");
  flush();

  expect(notified().map(({ newest }) => newest.conversationId)).toEqual([
    directMessage,
    "G0AKFJBEU",
  ]);
  expect(notified()[0]!.newest.conversationKind).toBe("im");
});

test("a thread reply mentioning the user, or in a DM, notifies; one that does not mention doesn't", async () => {
  await start();

  await say(general, { ...mentionMe, thread_ts: "1699999999.000001" });
  flush();
  await say(directMessage, { thread_ts: "1699999999.000002" }, "im");
  flush();
  await say(general, { thread_ts: "1699999999.000003" });
  flush();

  expect(notified()).toHaveLength(2);
  expect(notified()[0]!.newest.threadTs).toBe("1699999999.000001");
});

test("the user's own messages never notify", async () => {
  await start();

  await say(general, { user: me, text: `<@${me}> note to self` });
  await say(directMessage, { user: me }, "im");
  flush();

  expect(notified()).toEqual([]);
});

test("edits and deletes never notify", async () => {
  await start();

  await harness.sendEvents({
    event: {
      type: "message",
      subtype: "message_changed",
      channel: general,
      channel_type: "channel",
      ts: "1700000100.000001",
      message: {
        type: "message",
        user: other,
        text: `now <@${me}>`,
        ts: "1700000000.000500",
      },
    },
  });
  await harness.sendEvents({
    event: {
      type: "message",
      subtype: "message_deleted",
      channel: directMessage,
      channel_type: "im",
      ts: "1700000100.000002",
      deleted_ts: "1700000000.000600",
      previous_message: {
        type: "message",
        user: other,
        text: "gone",
        ts: "1700000000.000600",
      },
    },
  });
  flush();

  expect(notified()).toEqual([]);
});

test("history loaded from Slack never notifies", async () => {
  await start({
    prepare: (slack) =>
      slack.respond("conversations.history", () => ({
        ok: true,
        has_more: false,
        messages: [
          {
            type: "message",
            user: other,
            text: `<@${me}> old`,
            ts: "1600000000.000100",
          },
        ],
      })),
  });

  await harness.session.loadHistory(general);
  flush();

  expect(notified()).toEqual([]);
});

test("the startup unread check marks conversations but never notifies", async () => {
  harness = await startSessionHarness({
    clock,
    unreadCheck: { retryDelayMs: 10 },
    prepare: (slack) => {
      slack.respond("conversations.info", ({ params }) => ({
        ok: true,
        channel: {
          id: params.channel,
          is_im: String(params.channel).startsWith("D"),
          last_read: "1.000000",
        },
      }));
      slack.respond("conversations.history", () => ({
        ok: true,
        messages: [
          { type: "message", user: other, text: "hi", ts: "1700000000.000100" },
        ],
      }));

      return seedWorkspace(slack);
    },
  });

  await waitFor(() => harness.session.markers(directMessage).isUnread);
  flush();

  expect(notified()).toEqual([]);
});

test("notifications close together arrive as one burst, with every message in it", async () => {
  await start();

  await say(general, { text: `<@${me}> one` });
  clock.advance(400);
  await say(directMessage, { text: "two" }, "im");
  clock.advance(400);
  await say(general, { text: `<@${me}> three` });

  expect(notified()).toEqual([]);

  clock.advance(200);

  expect(notified()).toHaveLength(1);
  expect(notified()[0]).toMatchObject({ count: 3, isBurst: true });
  expect(notified()[0]!.messages.map(({ text }) => text)).toEqual([
    expect.stringContaining("one"),
    "two",
    expect.stringContaining("three"),
  ]);
  expect(notified()[0]!.newest).toBe(notified()[0]!.messages[2]!);

  await say(general, { text: `<@${me}> four` });
  flush();

  expect(notified()).toHaveLength(2);
  expect(notified()[1]).toMatchObject({ count: 1, isBurst: false });
});

test("the gathering window is configurable", async () => {
  await start({ windowMs: 60_000 });

  await say(directMessage, {}, "im");
  clock.advance(59_000);

  expect(notified()).toEqual([]);

  clock.advance(1000);

  expect(notified()).toHaveLength(1);
});

test("nothing is sent after the session stops", async () => {
  await start();

  await say(directMessage, {}, "im");
  await harness.session.stop();
  flush();

  expect(notified()).toEqual([]);
});

test("nothing notifies while the terminal is focused, in any conversation", async () => {
  await start();
  harness.session.setOpenConversation(general);
  harness.session.setTerminalFocused(true);

  await say(general, mentionMe);
  await say(random, mentionMe);
  await say(directMessage, {}, "im");
  await say(general, { ...mentionMe, thread_ts: "1699999999.000001" });
  flush();

  expect(notified()).toEqual([]);
});

test("a terminal that is not focused, or never says, notifies even in the open conversation", async () => {
  await start();
  harness.session.setOpenConversation(general);

  await say(general, mentionMe);
  flush();

  expect(notified()).toHaveLength(1);

  harness.session.setTerminalFocused(false);
  await say(general, mentionMe);
  flush();

  expect(notified()).toHaveLength(2);

  harness.session.setTerminalFocused(true);
  harness.session.setTerminalFocused(undefined);
  await say(general, mentionMe);
  flush();

  expect(notified()).toHaveLength(3);
});

test("termslack has no record of muted conversations, so none are left out", async () => {
  await start();

  await say(general, mentionMe);
  flush();

  expect(notified()).toHaveLength(1);
});

const snoozing = (seconds: number): DndFields => ({
  dnd_enabled: false,
  snooze_enabled: true,
  snooze_endtime: at(seconds),
});

test("a snooze read from dnd.info silences notifications until it ends by itself", async () => {
  await start({ dnd: snoozing(600) });

  await say(directMessage, {}, "im");
  flush();

  expect(notified()).toEqual([]);

  clock.advance(600_000);
  await say(directMessage, {}, "im");
  flush();

  expect(notified()).toHaveLength(1);
});

test("a scheduled window starts and ends on its own while termslack runs", async () => {
  await start({
    dnd: {
      dnd_enabled: true,
      next_dnd_start_ts: at(60),
      next_dnd_end_ts: at(120),
      snooze_enabled: false,
    },
  });

  await say(directMessage, {}, "im");
  flush();

  expect(notified()).toHaveLength(1);

  clock.advance(57_000);
  await say(directMessage, {}, "im");
  flush();

  expect(notified()).toHaveLength(2);

  clock.advance(1000);
  await say(directMessage, {}, "im");
  flush();

  expect(notified()).toHaveLength(2);

  clock.advance(60_000);
  await say(directMessage, {}, "im");
  flush();

  expect(notified()).toHaveLength(3);
});

test("when a window ends termslack reads dnd.info again for the next one", async () => {
  await start({
    dnd: {
      dnd_enabled: true,
      next_dnd_start_ts: at(-60),
      next_dnd_end_ts: at(60),
    },
  });

  expect(dndCalls()).toHaveLength(1);

  clock.advance(60_000);
  await waitFor(() => dndCalls().length === 2);
});

test("a scheduled window already under way silences notifications", async () => {
  await start({
    dnd: {
      dnd_enabled: true,
      next_dnd_start_ts: at(-60),
      next_dnd_end_ts: at(60),
    },
  });

  await say(directMessage, {}, "im");
  flush();

  expect(notified()).toEqual([]);
});

test("scheduled hours that are switched off don't silence anything", async () => {
  await start({
    dnd: {
      dnd_enabled: false,
      next_dnd_start_ts: at(-60),
      next_dnd_end_ts: at(60),
    },
  });

  await say(directMessage, {}, "im");
  flush();

  expect(notified()).toHaveLength(1);
});

test("dnd_updated turns Do Not Disturb on and off, snooze and schedule included", async () => {
  await start();

  const [mine] = await loadFixture("dnd-updated");
  const update = (status: DndFields) =>
    harness.sendEvents({
      ...mine!,
      event: { ...mine!.event, dnd_status: status },
    });

  await update(snoozing(300));
  await say(directMessage, {}, "im");
  flush();

  expect(notified()).toEqual([]);

  await update(idle);
  await say(directMessage, {}, "im");
  flush();

  expect(notified()).toHaveLength(1);

  await update({
    dnd_enabled: true,
    next_dnd_start_ts: at(-10),
    next_dnd_end_ts: at(10),
  });
  await say(directMessage, {}, "im");
  flush();

  expect(notified()).toHaveLength(1);

  clock.advance(10_000);
  await say(directMessage, {}, "im");
  flush();

  expect(notified()).toHaveLength(2);
});

test("someone else's Do Not Disturb changes nothing", async () => {
  await start();

  const others = (await loadFixture("dnd-updated"))[1]!;

  await harness.sendEvents({
    ...others,
    event: {
      ...others.event,
      dnd_status: {
        dnd_enabled: true,
        next_dnd_start_ts: at(-10),
        next_dnd_end_ts: at(10),
      },
    },
  });
  await say(directMessage, {}, "im");
  flush();

  expect(notified()).toHaveLength(1);
});

test("dnd.info is read once at startup", async () => {
  await start();

  expect(dndCalls()).toHaveLength(1);
  expect(harness.session.dndNote()).toBeUndefined();
});

test("when dnd.info fails, notifications ring normally and the session says why", async () => {
  await start({ dnd: new Error("down") });

  expect(harness.session.dndNote()).toContain("Do Not Disturb");

  await say(directMessage, {}, "im");
  flush();

  expect(notified()).toHaveLength(1);
  expect(dndCalls()).toHaveLength(1);
});

test("a later dnd_updated clears the note and takes effect", async () => {
  await start({ dnd: new Error("down") });

  const [mine] = await loadFixture("dnd-updated");

  await harness.sendEvents({
    ...mine!,
    event: { ...mine!.event, dnd_status: snoozing(300) },
  });
  await say(directMessage, {}, "im");
  flush();

  expect(harness.session.dndNote()).toBeUndefined();
  expect(notified()).toEqual([]);
});

test("without the dnd:read scope termslack doesn't ask, rings normally and says so", async () => {
  await start({
    readsDnd: false,
    prepare: (slack) => slack.grantScopes(["chat:write", "users:read"]),
  });

  expect(dndCalls()).toHaveLength(0);
  expect(harness.session.dndNote()).toContain("dnd:read");
  expect(harness.session.scopeProblem("dnd")).toContain("dnd:read");

  await say(directMessage, {}, "im");
  flush();

  expect(notified()).toHaveLength(1);
});

test("the fixtures' dnd.info and dnd_updated shapes are understood", async () => {
  const [snoozed, scheduled] = await loadFixture("dnd-info");

  expect(convertDndStatus(snoozed)).toEqual({
    scheduleEnabled: true,
    nextStartTs: 1450387800,
    nextEndTs: 1450423800,
    snoozeEndTs: 1450373897,
  });
  expect(convertDndStatus(scheduled)?.snoozeEndTs).toBeUndefined();
  expect(convertDndStatus({ ok: true })).toBeUndefined();

  expect(
    convertEnvelope("events_api", await loadPayload("dnd-updated")),
  ).toMatchObject({
    kind: "dnd",
    eventType: "dnd_updated",
    userId: me,
    status: { snoozeEndTs: 1450373897 },
    issues: [],
  });
});

const interval = 60_000;

test("after a notification, mentions and DMs within the minute are held and go out as one when it is up", async () => {
  await start({ intervalMs: interval });

  await say(directMessage, { text: "first" }, "im");
  flush();

  expect(notified()).toHaveLength(1);

  await say(general, { text: `<@${me}> two` });
  clock.advance(20_000);
  await say(directMessage, { text: "three" }, "im");
  clock.advance(20_000);
  await say(random, { text: `<@${me}> four` });
  flush();

  expect(notified()).toHaveLength(1);

  clock.advance(interval - 1000 - 40_000 - 1);

  expect(notified()).toHaveLength(1);

  clock.advance(1);

  expect(notified()).toHaveLength(2);
  expect(notified()[1]).toMatchObject({ count: 3, isBurst: true });
  expect(notified()[1]!.newest.text).toContain("four");
});

test("the minute counts from when the last notification went out", async () => {
  await start({ intervalMs: interval });

  await say(directMessage, {}, "im");
  flush();
  clock.advance(10_000);
  await say(directMessage, {}, "im");
  clock.advance(50_000);

  expect(notified()).toHaveLength(2);
});

test("after a quiet minute the next message notifies straight away", async () => {
  await start({ intervalMs: interval });

  await say(directMessage, {}, "im");
  flush();
  clock.advance(interval);
  await say(directMessage, {}, "im");
  flush();

  expect(notified()).toHaveLength(2);
});

test("focusing the terminal drops what is being held", async () => {
  await start({ intervalMs: interval });

  await say(directMessage, {}, "im");
  flush();
  await say(directMessage, {}, "im");
  harness.session.setTerminalFocused(true);
  harness.session.setTerminalFocused(false);
  clock.advance(interval);

  expect(notified()).toHaveLength(1);
});

test("Do Not Disturb starting drops what is being held", async () => {
  await start({ intervalMs: interval });

  const [mine] = await loadFixture("dnd-updated");

  await say(directMessage, {}, "im");
  flush();
  await say(directMessage, {}, "im");
  await harness.sendEvents({
    ...mine!,
    event: { ...mine!.event, dnd_status: snoozing(300) },
  });
  await harness.sendEvents({
    ...mine!,
    event: { ...mine!.event, dnd_status: idle },
  });
  clock.advance(interval);

  expect(notified()).toHaveLength(1);
});

test("Do Not Disturb that starts by schedule while messages are held drops them", async () => {
  await start({
    intervalMs: interval,
    dnd: {
      dnd_enabled: true,
      next_dnd_start_ts: at(30),
      next_dnd_end_ts: at(600),
    },
  });

  await say(directMessage, {}, "im");
  flush();
  await say(directMessage, {}, "im");
  clock.advance(interval);

  expect(notified()).toHaveLength(1);
});

test("the interval is a minute unless a session is told otherwise", () => {
  expect(notificationIntervalMs).toBe(60_000);
});

test("a batch dropped by Do Not Disturb at delivery doesn't start the minute", async () => {
  await start({
    intervalMs: interval,
    dnd: {
      dnd_enabled: true,
      next_dnd_start_ts: at(1),
      next_dnd_end_ts: at(5),
    },
  });

  await say(directMessage, { text: "dropped" }, "im");
  flush();

  expect(notified()).toEqual([]);

  clock.advance(5000);
  await say(directMessage, { text: "alerts" }, "im");
  flush();

  expect(notified()).toHaveLength(1);
  expect(notified()[0]!.newest.text).toContain("alerts");
});
