import { afterEach, beforeEach, expect, test } from "bun:test";
import { loadPayload } from "./support/fixtures";
import {
  type SessionHarness,
  startSessionHarness,
} from "./support/sessionHarness";
import { waitFor } from "./support/fakeSlack";

let harness: SessionHarness;

beforeEach(async () => {
  harness = await startSessionHarness({ clientPingTimeout: 50 });
});

afterEach(() => harness.stop());

test("reports a recorded message as a message event", async () => {
  const payload = await loadPayload("message");

  const event = await harness.sendEvents(payload);

  expect(event).toMatchObject({
    kind: "message",
    channelId: "C123ABC456",
    channelKind: "channel",
    userId: "U123ABC456",
    text: "Hello world",
    ts: "1355517523.000005",
    issues: [],
    raw: payload,
  });
});

test("acks every envelope, including ones it doesn't recognize", async () => {
  await harness.sendEnvelope("slash_commands", { command: "/termslack" });

  await waitFor(() =>
    harness.slack.socketMessages.find((m) =>
      m.envelope_id?.startsWith("envelope-"),
    ),
  );
});

test("reports edits, deletes and bot messages", async () => {
  expect(
    await harness.sendEvents(await loadPayload("message-changed")),
  ).toMatchObject({
    kind: "messageEdited",
    userId: "U123ABC456",
    text: "Hello, world!",
    messageTs: "1355517523.000005",
  });

  expect(
    await harness.sendEvents(await loadPayload("message-deleted")),
  ).toMatchObject({
    kind: "messageDeleted",
    messageTs: "1358878749.000002",
  });

  expect(
    await harness.sendEvents(await loadPayload("bot-message")),
  ).toMatchObject({
    kind: "message",
    botId: "BB12033",
    subtype: "bot_message",
    text: "Pushing is the answer",
  });
});

test("reports a thread broadcast with its thread timestamp", async () => {
  expect(
    await harness.sendEvents(await loadPayload("thread-broadcast")),
  ).toMatchObject({
    kind: "message",
    subtype: "thread_broadcast",
    threadTs: "1673464730.703009",
  });
});

test("reports reactions", async () => {
  expect(
    await harness.sendEvents(await loadPayload("reaction-added")),
  ).toMatchObject({
    kind: "reaction",
    action: "added",
    userId: "U123ABC456",
    reaction: "thumbsup",
    channelId: "C123ABC456",
    messageTs: "1360782400.498405",
  });
});

test("passes unknown event types through with the raw body", async () => {
  const payload = { event: { type: "pin_added", user: "U1", event_ts: "1.1" } };

  expect(await harness.sendEvents(payload)).toMatchObject({
    kind: "unrecognized",
    envelopeType: "events_api",
    eventType: "pin_added",
    event: payload.event,
    raw: payload,
  });
});

test("falls back to empty values when expected fields are missing", async () => {
  const event = await harness.sendEvents({ event: { type: "message" } });

  expect(event).toMatchObject({
    kind: "message",
    channelId: "",
    text: "",
    ts: "",
  });
  expect(event.issues).toEqual(
    expect.arrayContaining(["missing channel", "missing ts"]),
  );

  expect(
    await harness.sendEvents({ event: { type: "reaction_added" } }),
  ).toMatchObject({ kind: "reaction", userId: "", reaction: "" });

  expect(
    await harness.sendEvents({
      event: { type: "message", subtype: "message_changed", channel: "C1" },
    }),
  ).toMatchObject({ kind: "messageEdited", text: "", messageTs: "" });
});

test("treats an envelope without an event as unrecognized instead of throwing", async () => {
  expect(await harness.sendEvents({ weird: true })).toMatchObject({
    kind: "unrecognized",
    envelopeType: "events_api",
    raw: { weird: true },
  });
});

test("reports connection changes and reconnects after disconnect", async () => {
  harness.slack.send({ type: "disconnect", reason: "refresh_requested" });

  await waitFor(
    () =>
      harness.events.filter(
        (event) => event.kind === "connection" && event.status === "connected",
      ).length === 2,
  );

  expect(harness.session.status).toBe("connected");
});

test("stops delivering events to an unsubscribed listener", async () => {
  const seen: string[] = [];
  const unsubscribe = harness.session.subscribe((event) =>
    seen.push(event.kind),
  );

  unsubscribe();
  await harness.sendEvents(await loadPayload("message"));

  expect(seen).toEqual([]);
});

test("start rejects with invalid_auth when the app-level token is revoked", async () => {
  harness.slack.respond("apps.connections.open", () => ({
    ok: false,
    error: "invalid_auth",
  }));

  const { createWorkspaceSession } =
    await import("../src/session/workspaceSession");

  await expect(
    createWorkspaceSession("xapp-revoked", "xoxp-test").start(),
  ).rejects.toMatchObject({
    data: { error: "invalid_auth" },
  });
});
