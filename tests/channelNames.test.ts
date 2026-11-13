import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
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

/** Starts a session whose startup listing returns the two channel pages and the DM page. */
async function startLoaded(
  options: Parameters<typeof startSessionHarness>[0] = {},
) {
  const pages = [
    ...(await loadFixture("users-conversations-channels")),
    ...(await loadFixture("users-conversations-dms")),
  ];

  harness = await startSessionHarness({
    ...options,
    prepare(slack) {
      slack.respondPaged("users.conversations", pages);
      return options.prepare?.(slack);
    },
  });

  logSession(harness.session, false);

  await waitFor(() => harness.session.conversation("D0BSHH4AD"));
}

function message(channel: string, ts = "1355517523.000005") {
  return {
    event: {
      type: "message",
      channel,
      user: "U123ABC456",
      text: "Hello",
      ts,
      channel_type: "channel",
    },
  };
}

function infoCalls() {
  return harness.slack.calls.filter(
    (call) => call.method === "conversations.info",
  );
}

/** The last logged line, without colours. */
const lastLine = () => plain(lines.at(-1) ?? "");

test("startup loads every conversation type, following pagination", async () => {
  await startLoaded();

  const listing = harness.slack.calls.filter(
    (call) => call.method === "users.conversations",
  );

  expect(listing).toHaveLength(2);
  expect(listing[0]?.token).toBe("xoxp-test");
  expect(listing[0]?.params.types).toBe(
    "public_channel,private_channel,mpim,im",
  );
  expect(listing[1]?.params.cursor).toBe("dGVhbTpDMDYxRkE1UEI=");

  expect(
    harness.session
      .conversations()
      .map(({ id, kind, name }) => ({ id, kind, name })),
  ).toEqual([
    { id: "C012AB3CD", kind: "channel", name: "general" },
    { id: "C061EG9T2", kind: "channel", name: "random" },
    { id: "G0AKFJBEU", kind: "mpim", name: "mpdm-user1--user2--user3-1" },
    { id: "D0C0F7S8Y", kind: "im", name: undefined },
    { id: "D0BSHH4AD", kind: "im", name: undefined },
  ]);
  expect(infoCalls()).toHaveLength(0);
});

test("messages and reactions in a known channel show its name", async () => {
  await startLoaded();

  await harness.sendEvents(message("C012AB3CD"));
  expect(lastLine()).toMatch(/ message +#general U123ABC456: Hello$/);

  await harness.sendEvents({
    event: {
      type: "reaction_added",
      user: "U1",
      reaction: "tada",
      item: { type: "message", channel: "C061EG9T2", ts: "1.1" },
    },
  });
  expect(lastLine()).toMatch(/ reaction_added +#random U1 \+🎉 on 1.1$/);
});

test("the log appears before the startup listing finishes", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));

  harness = await startSessionHarness({
    prepare(slack) {
      slack.respond("users.conversations", async () => {
        await gate;

        return { ok: true, channels: [] };
      });
      slack.respond("conversations.info", async () => ({
        ok: true,
        channel: (await loadPayload("conversations-info-channel")).channel,
      }));
    },
  });
  logSession(harness.session, false);

  await harness.sendEvents(message("C012AB3CD"));

  expect(lastLine()).toMatch(/ message +#general /);

  release();
});

test("an unknown channel is looked up once, even for simultaneous events", async () => {
  const info = await loadPayload("conversations-info-channel");

  await startLoaded({
    prepare: (slack) =>
      slack.respond("conversations.info", async () => {
        await Bun.sleep(30);

        return info;
      }),
  });

  const unknown = "C0UNKNOWN1";
  info.channel.id = unknown;

  for (const ts of ["1.1", "1.2", "1.3"]) {
    harness.slack.send({
      type: "events_api",
      envelope_id: `e-${ts}`,
      payload: message(unknown, ts),
    });
  }

  await waitFor(
    () => lines.filter((line) => plain(line).includes("#general")).length === 3,
  );

  harness.slack.send({
    type: "events_api",
    envelope_id: "e-later",
    payload: message(unknown, "1.4"),
  });
  await waitFor(
    () => lines.filter((line) => plain(line).includes("#general")).length === 4,
  );

  expect(infoCalls()).toHaveLength(1);
  expect(infoCalls()[0]?.params.channel).toBe(unknown);
});

test("a private channel is looked up and shown with #", async () => {
  await startLoaded();

  const info = await loadPayload("conversations-info-private");

  harness.slack.respond("conversations.info", () => info);

  await harness.sendEvents(message("G012AB3CD"));

  expect(lastLine()).toMatch(/ message +#secret /);
  expect(harness.session.conversation("G012AB3CD")).toMatchObject({
    kind: "group",
    name: "secret",
  });
});

test("an unresolvable channel shows its raw ID and isn't looked up again", async () => {
  await startLoaded();

  await harness.sendEvents(message("C0MISSING1"));
  await harness.sendEvents(message("C0MISSING1", "1.2"));

  expect(lastLine()).toMatch(/ message +#C0MISSING1 /);
  expect(infoCalls()).toHaveLength(1);
  expect(harness.session.conversation("C0MISSING1")).toBeUndefined();
});

test("a temporary lookup failure falls back to the ID and is retried later", async () => {
  await startLoaded();

  harness.slack.respond("conversations.info", () => ({
    ok: false,
    error: "internal_error",
  }));
  await harness.sendEvents(message("C0FLAKY001"));
  await harness.sendEvents(message("C0FLAKY001", "1.2"));

  expect(infoCalls()).toHaveLength(2);

  harness.slack.respond("conversations.info", () => ({
    ok: true,
    channel: { id: "C0FLAKY001", name: "flaky", is_member: true },
  }));
  await harness.sendEvents(message("C0FLAKY001", "1.3"));

  expect(lastLine()).toMatch(/#flaky /);
});

test("renaming a channel changes its name for every later event", async () => {
  await startLoaded();

  const renamed = await harness.sendEvents(await loadPayload("channel-rename"));

  expect(renamed).toMatchObject({
    kind: "conversation",
    action: "renamed",
    channelId: "C012AB3CD",
    name: "renamed",
  });
  expect(lastLine()).toMatch(/channel_rename +#renamed /);

  await harness.sendEvents(message("C012AB3CD"));

  expect(lastLine()).toMatch(/ message +#renamed /);
  expect(infoCalls()).toHaveLength(0);
});

test("a renamed private channel is updated by group_rename", async () => {
  await startLoaded();
  harness.slack.respond("conversations.info", () => ({
    ok: true,
    channel: { id: "G012AB3CD", name: "secret", is_private: true },
  }));

  await harness.sendEvents(message("G012AB3CD"));
  await harness.sendEvents(await loadPayload("group-rename"));
  await harness.sendEvents(message("G012AB3CD", "1.2"));

  expect(lastLine()).toMatch(/ message +#secret-renamed /);
});

test("creating a channel adds it to the store", async () => {
  await startLoaded();

  expect(
    await harness.sendEvents(await loadPayload("channel-created")),
  ).toMatchObject({ kind: "conversation", action: "created" });

  expect(harness.session.conversation("C012AB3CD")).toMatchObject({
    kind: "channel",
    name: "fun",
  });
});

test("archiving and unarchiving update the store", async () => {
  await startLoaded();

  await harness.sendEvents(await loadPayload("channel-archive"));
  expect(harness.session.conversation("C012AB3CD")?.isArchived).toBe(true);

  await harness.sendEvents(await loadPayload("channel-unarchive"));
  expect(harness.session.conversation("C012AB3CD")?.isArchived).toBe(false);
});

test("leaving and joining update membership, and only for the current user", async () => {
  await startLoaded();

  await harness.sendEvents(await loadPayload("channel-left"));
  expect(harness.session.conversation("C012AB3CD")?.isMember).toBe(false);

  const joined = await loadPayload("member-joined-channel");

  joined.event.user = "U999999999";
  await harness.sendEvents(joined);
  expect(harness.session.conversation("C012AB3CD")?.isMember).toBe(false);

  joined.event.user = "U123ABC456";
  expect(await harness.sendEvents(joined)).toMatchObject({
    kind: "conversation",
    action: "joined",
  });
  expect(harness.session.conversation("C012AB3CD")?.isMember).toBe(true);
});

test("a private channel leaving, archiving and deletion are tracked too", async () => {
  await startLoaded();
  harness.slack.respond("conversations.info", () => ({
    ok: true,
    channel: { id: "G012AB3CD", name: "secret", is_private: true },
  }));
  await harness.sendEvents(message("G012AB3CD"));

  await harness.sendEvents(await loadPayload("group-archive"));
  expect(harness.session.conversation("G012AB3CD")?.isArchived).toBe(true);

  await harness.sendEvents(await loadPayload("group-left"));
  expect(harness.session.conversation("G012AB3CD")?.isMember).toBe(false);

  await harness.sendEvents(await loadPayload("group-deleted"));
  expect(harness.session.conversation("G012AB3CD")).toBeUndefined();
});

test("a deleted channel leaves the store", async () => {
  await startLoaded();

  await harness.sendEvents(await loadPayload("channel-deleted"));

  expect(harness.session.conversation("C012AB3CD")).toBeUndefined();
});

test("conversation events with missing fields are reported, not thrown", async () => {
  await startLoaded();

  const event = await harness.sendEvents({ event: { type: "channel_rename" } });

  expect(event).toMatchObject({
    kind: "conversation",
    action: "renamed",
    channelId: "",
  });
  expect(event.issues).toContain("missing channel.id");
});
