import { afterEach, beforeEach, expect, test } from "bun:test";
import type { SocketModeClient } from "@slack/socket-mode";
import { connectSocket, type SocketStatus } from "../src/slack/socket";
import { type FakeSlack, startFakeSlack, waitFor } from "./support/fakeSlack";

let slack: FakeSlack;
let client: SocketModeClient | undefined;

const ignore = () => {};

beforeEach(() => {
  slack = startFakeSlack();
  process.env.TERMSLACK_SLACK_API_URL = slack.apiUrl;
});

afterEach(async () => {
  await client?.disconnect();
  client = undefined;

  await slack.stop();
  delete process.env.TERMSLACK_SLACK_API_URL;
});

test("opens the socket using the app-level token", async () => {
  client = await connectSocket("xapp-test", {
    onEvent: ignore,
    onStatus: ignore,
  });

  expect(slack.calls).toEqual([
    expect.objectContaining({
      method: "apps.connections.open",
      token: "xapp-test",
    }),
  ]);
});

test("acks each envelope and passes the event to the handler", async () => {
  const events: { type: string; body: Record<string, any> }[] = [];

  client = await connectSocket("xapp-test", {
    onEvent: (type, body) => events.push({ type, body }),
    onStatus: ignore,
  });

  const event = {
    type: "message",
    channel: "C1",
    user: "U1",
    text: "hello",
    ts: "1700000000.000100",
  };

  slack.send({
    type: "events_api",
    envelope_id: "envelope-1",
    payload: { event },
    accepts_response_payload: false,
  });

  const ack = await waitFor(() =>
    slack.socketMessages.find(
      (message) => message.envelope_id === "envelope-1",
    ),
  );

  expect(ack).toMatchObject({ envelope_id: "envelope-1" });
  expect(events).toEqual([{ type: "events_api", body: { event } }]);
});

test("reconnects with a fresh URL when Slack sends disconnect", async () => {
  const statuses: SocketStatus[] = [];

  client = await connectSocket(
    "xapp-test",
    { onEvent: ignore, onStatus: (status) => statuses.push(status) },
    { clientPingTimeout: 50 },
  );

  slack.send({ type: "disconnect", reason: "refresh_requested" });

  await waitFor(
    () => statuses.filter((status) => status === "connected").length === 2,
  );

  expect(
    slack.calls.filter((call) => call.method === "apps.connections.open"),
  ).toHaveLength(2);
  expect(statuses).toContain("reconnecting");
});

test("rejects with invalid_auth when the app-level token is revoked", async () => {
  slack.respond("apps.connections.open", () => ({
    ok: false,
    error: "invalid_auth",
  }));

  const connecting = connectSocket("xapp-revoked", {
    onEvent: ignore,
    onStatus: ignore,
  });

  await expect(connecting).rejects.toMatchObject({
    data: { error: "invalid_auth" },
  });
});
