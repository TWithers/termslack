import { afterEach, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { waitFor } from "./support/fakeSlack";
import { seedWorkspace, startAppHarness } from "./support/appHarness";
import { fakeTerminal } from "./support/fakeTerminal";
import {
  type SessionHarness,
  startSessionHarness,
} from "./support/sessionHarness";
import { runApp } from "../src/ui/app/run";
import {
  createDesktopNotifier,
  type DesktopNotifier,
} from "../src/ui/app/desktopNotifications";

let harness: SessionHarness;

afterEach(() => harness.stop());

const me = "U123ABC456";
const other = "U222222222";
const general = "C012AB3CD";
const random = "C061EG9T2";

const focusOn = "\x1b[?1004h";
const focusOff = "\x1b[?1004l";
const focusIn = "\x1b[I";
const focusOut = "\x1b[O";

let counter = 0;

async function startRunning({
  bell,
  windowMs = 20,
  intervalMs,
  desktop,
  notifier,
  history,
}: {
  bell?: boolean;
  windowMs?: number;
  intervalMs?: number;
  desktop?: boolean;
  notifier?: DesktopNotifier;
  /** Messages #general's history holds. */
  history?: Record<string, unknown>[];
} = {}) {
  harness = await startSessionHarness({
    prepare: async (slack) => {
      await seedWorkspace(slack);

      if (history) {
        slack.respond("conversations.history", () => ({
          ok: true,
          messages: history,
          has_more: false,
        }));
        slack.respond("conversations.replies", () => ({
          ok: true,
          messages: history,
          has_more: false,
        }));
      }
    },
    notificationWindowMs: windowMs,
    notificationIntervalMs: intervalMs,
  });

  const terminal = fakeTerminal();
  const signals = new EventEmitter();
  const bells: number[] = [];
  const finished = runApp(
    { session: harness.session, workspaceName: "Acme" },
    {
      signals,
      bell,
      desktopNotifications: desktop,
      desktopNotifier: notifier,
      ringBell: () => bells.push(Date.now()),
      stdout: terminal.stdout,
      stdin: terminal.stdin as unknown as NodeJS.ReadStream,
    },
  );

  await waitFor(() => terminal.written().includes("● connected"));
  await waitFor(() => harness.session.listingHealth().people === "loaded");
  await waitFor(
    () => harness.session.listingHealth().conversations === "loaded",
  );
  await Bun.sleep(50);

  terminal.stdin.write("\r");
  await waitFor(() =>
    harness.slack.calls.some(
      (call) =>
        call.method === "conversations.history" &&
        call.params.channel === general,
    ),
  );
  await Bun.sleep(50);

  return { terminal, signals, finished, bells };
}

function say(channel: string, text = `hey <@${me}>`, threadTs?: string) {
  counter += 1;

  return harness.sendEvents({
    event: {
      type: "message",
      channel,
      channel_type: "channel",
      user: other,
      text,
      thread_ts: threadTs,
      ts: `1700000000.${String(counter).padStart(6, "0")}`,
    },
  });
}

test.each(["q", "ctrlC", "SIGINT", "SIGTERM"] as const)(
  "termslack asks for focus reports and turns them off again when leaving by %s",
  async (leave) => {
    const { terminal, signals, finished } = await startRunning();

    expect(terminal.written()).toContain(focusOn);
    expect(terminal.written()).not.toContain(focusOff);

    if (leave === "q") {
      terminal.stdin.write("q");
    } else if (leave === "ctrlC") {
      terminal.stdin.write("\x03");
    } else {
      signals.emit(leave);
    }

    await finished;

    expect(terminal.written().lastIndexOf(focusOff)).toBeGreaterThan(
      terminal.written().lastIndexOf(focusOn),
    );
  },
);

test("the focus-off request is also sent if the process exits some other way", async () => {
  const before = process.listenerCount("exit");
  const { terminal, signals, finished } = await startRunning();

  expect(process.listenerCount("exit")).toBe(before + 1);

  signals.emit("SIGTERM");
  await finished;

  expect(process.listenerCount("exit")).toBe(before);
  expect(terminal.written()).toContain(focusOff);
});

test("focus codes never reach the input box as text or act as keys", async () => {
  const { terminal, signals, finished } = await startRunning();

  terminal.stdin.write("i");
  await Bun.sleep(50);

  const before = terminal.written().length;

  terminal.stdin.write(`a${focusIn}b${focusOut}c`);
  terminal.stdin.write(focusIn);
  terminal.stdin.write(focusOut);
  await Bun.sleep(80);

  const drawn = Bun.stripANSI(terminal.written().slice(before));

  expect(drawn).toContain("abc");
  expect(drawn).not.toContain("[I");
  expect(drawn).not.toContain("[O");

  signals.emit("SIGTERM");
  await finished;
});

test("nothing rings while the terminal is focused, in any conversation, and ringing resumes when it isn't", async () => {
  const { terminal, signals, finished, bells } = await startRunning();

  await say(general);
  await waitFor(() => bells.length === 1);

  terminal.stdin.write(focusIn);
  await Bun.sleep(30);
  await say(general);
  await say(random);
  await Bun.sleep(100);

  expect(bells).toHaveLength(1);

  terminal.stdin.write(focusOut);
  await Bun.sleep(30);
  await say(random);
  await waitFor(() => bells.length === 2);

  signals.emit("SIGTERM");
  await finished;
});

test("a burst rings once, and the next minute's mentions wait for it", async () => {
  const { signals, finished, bells } = await startRunning({
    windowMs: 100,
    intervalMs: 600,
  });

  await say(random);
  await say(random);
  await waitFor(() => bells.length === 1);
  await say(random);
  await Bun.sleep(300);

  expect(bells).toHaveLength(1);

  await waitFor(() => bells.length === 2);

  signals.emit("SIGTERM");
  await finished;
});

test("with the bell turned off nothing rings", async () => {
  const { terminal, signals, finished, bells } = await startRunning({
    bell: false,
  });

  await say(random);
  await Bun.sleep(100);

  expect(bells).toEqual([]);
  expect(terminal.written()).not.toContain("\x07");

  signals.emit("SIGTERM");
  await finished;
});

test("by default the bell is written to the terminal's output", async () => {
  harness = await startSessionHarness({
    prepare: seedWorkspace,
    notificationWindowMs: 20,
  });

  const terminal = fakeTerminal();
  const signals = new EventEmitter();
  const finished = runApp(
    { session: harness.session, workspaceName: "Acme" },
    {
      signals,
      stdout: terminal.stdout,
      stdin: terminal.stdin as unknown as NodeJS.ReadStream,
    },
  );

  await waitFor(() => terminal.written().includes("● connected"));
  await say(random);
  await waitFor(() => terminal.written().includes("\x07"));

  signals.emit("SIGTERM");
  await finished;
});

test("after quitting, notifications no longer ring", async () => {
  const { signals, finished, bells } = await startRunning();

  signals.emit("SIGTERM");
  await finished;
  await say(random).catch(() => undefined);
  await Bun.sleep(60);

  expect(bells).toEqual([]);
});

test("when dnd.info fails the status bar says so", async () => {
  const app = await startAppHarness({
    prepare: (slack) =>
      slack.respond("dnd.info", () => ({ ok: false, error: "fatal_error" })),
  });

  try {
    await app.waitForScreen("couldn't read Do Not Disturb");
  } finally {
    await app.stop();
  }
});

function fakeNotifier() {
  const shown: { title: string; body: string }[] = [];
  const notifier: DesktopNotifier = {
    show: (title, body) => void shown.push({ title, body }),
  };

  return { shown, notifier };
}

test("desktop notifications are off unless asked for", async () => {
  const { shown, notifier } = fakeNotifier();
  const { signals, finished, bells } = await startRunning({ notifier });

  await say(random, `<@${me}> plain`);
  await waitFor(() => bells.length === 1);

  expect(shown).toEqual([]);

  signals.emit("SIGTERM");
  await finished;
});

test("a notifying message shows conversation, author and plain text", async () => {
  const { shown, notifier } = fakeNotifier();
  const { signals, finished, bells } = await startRunning({
    desktop: true,
    notifier,
  });

  await say(random, `*bold* hey <@${me}> -- "quoted"\nsecond line`);
  await waitFor(() => shown.length === 1);

  expect(bells).toHaveLength(1);
  expect(shown[0]!.title).toStartWith("#random · ");
  expect(shown[0]!.title).not.toContain("U222222222");
  expect(shown[0]!.body).toMatch(/^bold hey @\S+ -- "quoted" second line$/);
  expect(shown[0]!.body).not.toContain("*");

  signals.emit("SIGTERM");
  await finished;
});

test("a long message is cut", async () => {
  const { shown, notifier } = fakeNotifier();
  const { signals, finished } = await startRunning({
    desktop: true,
    notifier,
  });

  await say(random, `<@${me}> ${"word ".repeat(200)}`);
  await waitFor(() => shown.length === 1);

  expect([...shown[0]!.body].length).toBeLessThanOrEqual(200);
  expect(shown[0]!.body).toEndWith("…");

  signals.emit("SIGTERM");
  await finished;
});

test("a burst shows one summary with the newest text", async () => {
  const { shown, notifier } = fakeNotifier();
  const { signals, finished } = await startRunning({
    desktop: true,
    notifier,
    windowMs: 300,
  });

  await say(random, `<@${me}> one`);
  await say(random, `<@${me}> two`);
  await say(random, `<@${me}> three`);
  await waitFor(() => shown.length > 0);
  await Bun.sleep(400);

  expect(shown).toHaveLength(1);
  expect(shown[0]!.title).toBe("3 new messages in #random");
  expect(shown[0]!.body).toEndWith("three");

  signals.emit("SIGTERM");
  await finished;
});

test("suppressed messages show nothing", async () => {
  const { shown, notifier } = fakeNotifier();
  const { terminal, signals, finished } = await startRunning({
    desktop: true,
    notifier,
  });

  terminal.stdin.write(focusIn);
  await Bun.sleep(30);
  await say(general);
  await Bun.sleep(100);

  expect(shown).toEqual([]);

  signals.emit("SIGTERM");
  await finished;
});

test("without the notification tool the status bar says so once and the bell carries on", async () => {
  const { terminal, signals, finished, bells } = await startRunning({
    desktop: true,
    notifier: createDesktopNotifier({ platform: "linux", which: () => null }),
  });

  await waitFor(() => terminal.written().includes("notify-send"));
  await say(random);
  await waitFor(() => bells.length === 1);

  signals.emit("SIGTERM");
  await finished;
});

test("after quitting, desktop notifications stop", async () => {
  const { shown, notifier } = fakeNotifier();
  const { signals, finished } = await startRunning({ desktop: true, notifier });

  signals.emit("SIGTERM");
  await finished;
  await say(random).catch(() => undefined);
  await Bun.sleep(60);

  expect(shown).toEqual([]);
});
