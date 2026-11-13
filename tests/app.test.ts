import { afterEach, expect, test } from "bun:test";
import { loadPayload } from "./support/fixtures";
import { waitFor } from "./support/fakeSlack";
import { sidebarGroups } from "../src/ui/app/sidebarEntries";
import { type AppHarness, keys, startAppHarness } from "./support/appHarness";

let app: AppHarness;

afterEach(() => app.stop());

async function start(options: Parameters<typeof startAppHarness>[0] = {}) {
  app = await startAppHarness(options);
  await app.waitForScreen("@Peter Venkman");
}

/** The lines of the screen that mention a conversation, in screen order. */
function sidebarOrder(): string[] {
  return app
    .screen()
    .split("\n")
    .flatMap((line) => line.match(/[#@][^\s│|][^│|]*/g) ?? [])
    .map((entry) => entry.trim());
}

test("the sidebar lists channels first, then DMs and group DMs, each sorted by name", async () => {
  await start();

  const screen = app.screen();

  expect(screen.indexOf("Channels")).toBeLessThan(screen.indexOf("#general"));
  expect(screen.indexOf("#general")).toBeLessThan(screen.indexOf("#random"));
  expect(screen.indexOf("#random")).toBeLessThan(
    screen.indexOf("Direct messages"),
  );
  expect(screen.indexOf("Direct messages")).toBeLessThan(
    screen.indexOf("@Peter Venkman"),
  );
});

test("the sidebar sorts by resolved name, not by ID", async () => {
  await start();
  await app.waitForScreen("@stantz");

  const names = sidebarOrder().filter((entry) => entry.startsWith("@"));

  expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  expect(names.length).toBeGreaterThanOrEqual(2);
});

test("conversations that load later appear without a keypress", async () => {
  let release!: () => void;
  const opened = new Promise<void>((resolve) => (release = resolve));

  app = await startAppHarness({
    seed: false,
    prepare: (slack) =>
      slack.respond("users.conversations", async () => {
        await opened;

        return {
          ok: true,
          channels: [
            { id: "C1", name: "late", is_channel: true, is_member: true },
          ],
        };
      }),
  });

  expect(app.screen()).not.toContain("#late");

  release();

  await app.waitForScreen("#late");
});

test("a renamed channel shows its new name", async () => {
  await start();

  await app.sendEvents(await loadPayload("channel-rename"));

  const screen = await app.waitForScreen("#renamed");

  expect(screen).not.toContain("#general");
});

test("an archived channel leaves the sidebar", async () => {
  await start();

  await app.sendEvents(await loadPayload("channel-archive"));
  await waitFor(() => !app.screen().includes("#general"));

  expect(app.screen()).toContain("#random");
});

test("a channel the user leaves goes, and one they join comes", async () => {
  await start();

  await app.sendEvents(await loadPayload("channel-left"));
  await waitFor(() => !app.screen().includes("#general"));

  await app.sendEvents(await loadPayload("channel-created"));
  expect(app.screen()).not.toContain("#general");

  await app.sendEvents(await loadPayload("member-joined-channel"));
  await app.waitForScreen("#");
});

test("the status bar shows the workspace, the user and the connection state", async () => {
  await start();

  const lastLine = app.screen().trimEnd().split("\n").at(-1)!;

  expect(lastLine).toContain("Acme");
  expect(lastLine).toContain("egon");
  expect(lastLine).toContain("connected");
});

test("the status bar follows a reconnect", async () => {
  await start({ clientPingTimeout: 50 });

  app.slack.send({ type: "disconnect", reason: "refresh_requested" });

  await waitFor(() =>
    app.frames().some((frame) => frame.includes("reconnecting")),
  );
  await waitFor(() =>
    /\bconnected\b/.test(app.screen().trimEnd().split("\n").at(-1)!),
  );
});

test("the layout fills the terminal and reflows on resize", async () => {
  await start({ columns: 100, rows: 30 });

  const lines = () => app.screen().split("\n");

  expect(lines()).toHaveLength(30);

  await app.resize(60, 12);

  expect(lines()).toHaveLength(12);
  expect(
    Math.max(...lines().map((line) => Bun.stringWidth(line))),
  ).toBeLessThanOrEqual(60);
  expect(lines().at(-1)).toContain("Acme");
});

test("a narrow, short terminal is never drawn past its edges", async () => {
  await start();

  await app.resize(24, 5);

  const lines = app.screen().split("\n");

  expect(lines).toHaveLength(5);
  expect(
    Math.max(...lines.map((line) => Bun.stringWidth(line))),
  ).toBeLessThanOrEqual(24);
});

test("q quits and disconnects the session", async () => {
  await start();

  await app.press("q");

  await waitFor(() => app.session.status === "disconnected");

  const drawn = app.frames().length;

  app.slack.send({
    type: "events_api",
    envelope_id: "after-quit",
    payload: await loadPayload("channel-rename"),
  });
  await Bun.sleep(30);

  expect(app.frames().length).toBe(drawn);
});

test("Ctrl+C quits and disconnects the session", async () => {
  await start();

  await app.press(keys.ctrlC);

  await waitFor(() => app.session.status === "disconnected");
});

test("after Slack asks for a reconnect, new messages still reach the open pane and the sidebar markers", async () => {
  await start({
    clientPingTimeout: 50,
    prepare: (slack) =>
      slack.respond("conversations.history", () => ({
        ok: true,
        messages: [],
      })),
  });

  await app.press(keys.enter);
  await app.waitForScreen("#general");

  const say = (channel: string, ts: string, text: string) =>
    app.sendEvents({
      event: {
        type: "message",
        channel,
        channel_type: "channel",
        user: "U222222222",
        text,
        ts,
      },
    });

  await say("C012AB3CD", "1700000000.000001", "before the reconnect");
  await app.waitForScreen("before the reconnect");

  const connections = () =>
    app.events.filter(
      (event) => event.kind === "connection" && event.status === "connected",
    ).length;

  app.slack.send({ type: "disconnect", reason: "refresh_requested" });
  await waitFor(() => connections() === 2);

  await say("C012AB3CD", "1700000000.000002", "after the reconnect");
  await say("C061EG9T2", "1700000000.000003", "elsewhere");

  await app.waitForScreen("after the reconnect");
  await waitFor(() =>
    sidebarGroups(app.session).channels.some(
      (entry) => entry.label === "#random" && entry.markers.isUnread,
    ),
  );
});

test("a failed startup listing shows a warning in the status bar until a retry succeeds", async () => {
  let attempts = 0;

  app = await startAppHarness({
    listingRetryDelaysMs: [150],
    prepare: (slack) => {
      const answer = slack.handler("users.conversations");

      slack.respond("users.conversations", (call) => {
        attempts += 1;

        return attempts === 1
          ? { ok: false, error: "ratelimited" }
          : answer(call);
      });
    },
  });

  const statusLine = () => app.screen().trimEnd().split("\n").at(-1)!;

  await waitFor(() =>
    statusLine().includes("couldn't load channel list — retrying"),
  );
  await app.waitForScreen("#general");
  await waitFor(() => !statusLine().includes("couldn't load"));
});

test("a listing that runs out of retries leaves a warning without 'retrying'", async () => {
  app = await startAppHarness({
    listingRetryDelaysMs: [10],
    prepare: (slack) =>
      slack.respond("users.list", () => ({ ok: false, error: "ratelimited" })),
  });

  await waitFor(() =>
    /couldn't load people(?! — retrying)/.test(
      app.screen().trimEnd().split("\n").at(-1)!,
    ),
  );
});
