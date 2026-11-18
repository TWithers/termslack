import { afterEach, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { waitFor } from "./support/fakeSlack";
import { loadFixture } from "./support/fixtures";
import { seedWorkspace, startAppHarness } from "./support/appHarness";
import { fakeTerminal } from "./support/fakeTerminal";
import {
  type SessionHarness,
  startSessionHarness,
} from "./support/sessionHarness";
import { runApp } from "../src/ui/app/run";

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
  env = {},
  probeTimeoutMs = 20,
  history,
  otherName,
}: {
  bell?: boolean;
  windowMs?: number;
  intervalMs?: number;
  desktop?: boolean;
  /** The terminal's environment: its TERM_PROGRAM decides the notification code. */
  env?: Record<string, string | undefined>;
  /** How long the startup probe waits for the terminal's answer. */
  probeTimeoutMs?: number;
  /** Messages #general's history holds. */
  history?: Record<string, unknown>[];
  /** What the other person is called, in every name Slack gives. */
  otherName?: string;
} = {}) {
  harness = await startSessionHarness({
    prepare: async (slack) => {
      await seedWorkspace(slack);

      if (otherName) {
        const pages = await loadFixture("users-list");

        slack.respondPaged(
          "users.list",
          pages.map((page) => ({
            ...page,
            members: page.members.map((member: Record<string, any>) =>
              member.id === other
                ? {
                    ...member,
                    name: otherName,
                    real_name: otherName,
                    profile: { ...member.profile, display_name: otherName },
                  }
                : member,
            ),
          })),
        );
      }

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
      env,
      probeTimeoutMs,
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

test("when dnd.info fails the status line says so", async () => {
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

const ghostty = { TERM_PROGRAM: "ghostty" };
const oscStart = "\x1b]777;notify;";

function notificationsWritten(terminal: { written(): string }) {
  return [
    ...terminal
      .written()
      .matchAll(/\x1b\]777;notify;([^;\x07]*);([^\x07]*)\x07/g),
  ].map((match) => ({ title: match[1]!, body: match[2]! }));
}

test("desktop notifications are off unless asked for", async () => {
  const { terminal, signals, finished, bells } = await startRunning({
    env: ghostty,
  });

  await say(random, `<@${me}> plain`);
  await waitFor(() => bells.length === 1);

  expect(terminal.written()).not.toContain(oscStart);
  expect(terminal.written()).not.toContain("aren't supported");

  signals.emit("SIGTERM");
  await finished;
});

test("turned off, an unknown terminal gets no notice either", async () => {
  const { terminal, signals, finished } = await startRunning({
    desktop: false,
    env: { TERM_PROGRAM: "Apple_Terminal" },
  });

  await Bun.sleep(50);

  expect(terminal.written()).not.toContain("aren't supported");

  signals.emit("SIGTERM");
  await finished;
});

test("under Ghostty a notifying message writes one OSC 777 notification with conversation, author and plain text", async () => {
  const { terminal, signals, finished, bells } = await startRunning({
    desktop: true,
    env: ghostty,
  });

  await say(random, `*bold* hey <@${me}> -- "quoted"\nsecond line`);
  await waitFor(() => notificationsWritten(terminal).length === 1);

  const [shown] = notificationsWritten(terminal);

  expect(bells).toHaveLength(1);
  expect(shown!.title).toStartWith("#random · ");
  expect(shown!.title).not.toContain("U222222222");
  expect(shown!.body).toMatch(/^bold hey @\S+ -- "quoted" second line$/);
  expect(terminal.written()).not.toContain("aren't supported");

  signals.emit("SIGTERM");
  await finished;
});

test("a direct message is titled by the person who wrote", async () => {
  const { terminal, signals, finished } = await startRunning({
    desktop: true,
    env: ghostty,
  });

  await harness.sendEvents({
    event: {
      type: "message",
      channel: "D012AB3CD",
      channel_type: "im",
      user: other,
      text: "hi there",
      ts: "1700000100.000001",
    },
  });
  await waitFor(() => notificationsWritten(terminal).length === 1);

  expect(notificationsWritten(terminal)[0]!.body).toBe("hi there");

  signals.emit("SIGTERM");
  await finished;
});

test("control characters are removed from the notification and a semicolon in the title becomes a comma", async () => {
  const { terminal, signals, finished } = await startRunning({
    desktop: true,
    env: ghostty,
  });

  await say(random, `<@${me}> a\x1b]0;evil\x07b\x9bc\x7fd; e\x00f`);
  await waitFor(() => terminal.written().includes(oscStart));

  const written = terminal.written();
  const start = written.indexOf(oscStart);
  const end = written.indexOf("\x07", start);
  const sequence = written.slice(start, end + 1);

  expect(sequence).toMatch(
    /^\x1b\]777;notify;[^;\x00-\x1f\x7f-\x9f]*;[^\x00-\x1a\x1c-\x1f\x7f-\x9f]*\x07$/,
  );
  expect(sequence).toContain("a]0;evilbcd; ef");

  signals.emit("SIGTERM");
  await finished;
});

test("a long message is cut", async () => {
  const { terminal, signals, finished } = await startRunning({
    desktop: true,
    env: ghostty,
  });

  await say(random, `<@${me}> ${"word ".repeat(200)}`);
  await waitFor(() => notificationsWritten(terminal).length === 1);

  const [shown] = notificationsWritten(terminal);

  expect([...shown!.body].length).toBeLessThanOrEqual(200);
  expect(shown!.body).toEndWith("…");

  signals.emit("SIGTERM");
  await finished;
});

test("a burst writes one summary with the newest text", async () => {
  const { terminal, signals, finished } = await startRunning({
    desktop: true,
    env: ghostty,
    windowMs: 300,
  });

  await say(random, `<@${me}> one`);
  await say(random, `<@${me}> two`);
  await say(random, `<@${me}> three`);
  await waitFor(() => notificationsWritten(terminal).length > 0);
  await Bun.sleep(400);

  const shown = notificationsWritten(terminal);

  expect(shown).toHaveLength(1);
  expect(shown[0]!.title).toBe("3 new messages in #random");
  expect(shown[0]!.body).toEndWith("three");

  signals.emit("SIGTERM");
  await finished;
});

test("suppressed messages write nothing", async () => {
  const { terminal, signals, finished } = await startRunning({
    desktop: true,
    env: ghostty,
  });

  terminal.stdin.write(focusIn);
  await Bun.sleep(30);
  await say(general);
  await Bun.sleep(100);

  expect(terminal.written()).not.toContain(oscStart);

  signals.emit("SIGTERM");
  await finished;
});

test("in a terminal with no known code the status line says so once and the bell carries on", async () => {
  const { terminal, signals, finished, bells } = await startRunning({
    desktop: true,
    env: { TERM_PROGRAM: "Apple_Terminal" },
  });

  await waitFor(() => terminal.written().includes("aren't supported"));
  await say(random);
  await waitFor(() => bells.length === 1);

  expect(terminal.written()).not.toContain(oscStart);
  expect(
    terminal.written().split("desktop notifications aren't supported").length,
  ).toBeLessThanOrEqual(2);

  signals.emit("SIGTERM");
  await finished;
});

test("after quitting, desktop notifications stop", async () => {
  const { terminal, signals, finished } = await startRunning({
    desktop: true,
    env: ghostty,
  });

  signals.emit("SIGTERM");
  await finished;
  await say(random).catch(() => undefined);
  await Bun.sleep(60);

  expect(terminal.written()).not.toContain(oscStart);
});

async function startTyping(terminal: {
  stdin: { write(text: string): unknown };
}) {
  terminal.stdin.write("\t");
  await Bun.sleep(50);
  terminal.stdin.write("i");
  await Bun.sleep(50);
}

/** What was drawn after `since`, as plain text. */
function drawnSince(terminal: { written(): string }, since: number) {
  return Bun.stripANSI(terminal.written().slice(since));
}

const probeBytes = "\x1b[>0q\x1b[c";
const ghosttyAnswers = "\x1bP>|ghostty 1.4.0\x1b\\\x1b[?62;22;52c";
const soloAnswer = "\x1b[?64;1;2;6;22c";

test.each([
  ["on with a terminal", true],
  ["off", false],
] as const)(
  "the probe's bytes are written when notifications are %s",
  async (_, desktop) => {
    const { terminal, signals, finished } = await startRunning({ desktop });

    expect(terminal.written().includes(probeBytes)).toBe(desktop);

    signals.emit("SIGTERM");
    await finished;
  },
);

test("the probe is written once, after the reporting setup", async () => {
  const { terminal, signals, finished } = await startRunning({
    desktop: true,
  });
  const written = terminal.written();

  expect(written.split(probeBytes)).toHaveLength(2);
  expect(written.indexOf(probeBytes)).toBeGreaterThan(written.indexOf(focusOn));

  signals.emit("SIGTERM");
  await finished;
});

test("Ghostty's answers, with no TERM_PROGRAM, lead to OSC 777 notifications", async () => {
  const { terminal, signals, finished } = await startRunning({
    desktop: true,
    probeTimeoutMs: 5000,
  });

  terminal.stdin.write(ghosttyAnswers);
  await Bun.sleep(30);
  await say(random);
  await waitFor(() => notificationsWritten(terminal).length === 1);

  expect(terminal.written()).not.toContain("aren't supported");

  signals.emit("SIGTERM");
  await finished;
});

test("Solo's answer gives no name, so TERM_PROGRAM decides", async () => {
  const { terminal, signals, finished } = await startRunning({
    desktop: true,
    env: ghostty,
    probeTimeoutMs: 5000,
  });

  terminal.stdin.write(soloAnswer);
  await Bun.sleep(30);
  await say(random);
  await waitFor(() => notificationsWritten(terminal).length === 1);

  signals.emit("SIGTERM");
  await finished;
});

test("Solo's answer with no TERM_PROGRAM says notifications aren't supported", async () => {
  const { terminal, signals, finished } = await startRunning({
    desktop: true,
    probeTimeoutMs: 5000,
  });

  terminal.stdin.write(soloAnswer);
  await waitFor(() => terminal.written().includes("aren't supported"));

  signals.emit("SIGTERM");
  await finished;
});

test("with no answer before the timeout, TERM_PROGRAM decides", async () => {
  const { terminal, signals, finished } = await startRunning({
    desktop: true,
    env: ghostty,
    probeTimeoutMs: 100,
  });

  await Bun.sleep(150);
  await say(random);
  await waitFor(() => notificationsWritten(terminal).length === 1);

  signals.emit("SIGTERM");
  await finished;
});

test("before the probe finishes there is no desktop notifier", async () => {
  const { terminal, signals, finished } = await startRunning({
    desktop: true,
    env: ghostty,
    probeTimeoutMs: 5000,
  });

  await say(random);
  await Bun.sleep(100);

  expect(notificationsWritten(terminal)).toHaveLength(0);

  signals.emit("SIGTERM");
  await finished;
});

test("answers ended by BEL or ST are both removed from typed text", async () => {
  const { terminal, signals, finished } = await startRunning({
    desktop: true,
    probeTimeoutMs: 5000,
  });

  await startTyping(terminal);

  const before = terminal.written().length;

  terminal.stdin.write("a\x1bP>|ghostty 1.4.0\x07b");
  terminal.stdin.write("c\x1bP>|ghostty 1.4.0\x1b\\d\x1b[?62;22;52ce");
  await Bun.sleep(80);

  expect(drawnSince(terminal, before)).toContain("abcde");
  expect(drawnSince(terminal, before)).not.toContain("ghostty");

  signals.emit("SIGTERM");
  await finished;
});

test("an answer split across chunks is removed, not leaked", async () => {
  const { terminal, signals, finished } = await startRunning({
    desktop: true,
    probeTimeoutMs: 5000,
  });

  await startTyping(terminal);

  const before = terminal.written().length;

  for (const piece of [
    "x\x1bP>|ghos",
    "tty 1.4.0\x1b",
    "\\y\x1b[?62;",
    "22cz",
  ]) {
    terminal.stdin.write(piece);
    await Bun.sleep(15);
  }

  await Bun.sleep(50);

  expect(drawnSince(terminal, before)).toContain("xyz");
  expect(drawnSince(terminal, before)).not.toContain("ghostty 1.4.0");
  expect(drawnSince(terminal, before)).not.toContain("62;22");

  signals.emit("SIGTERM");
  await finished;
});

test("a late answer is removed and changes nothing", async () => {
  const { terminal, signals, finished } = await startRunning({
    desktop: true,
    env: { TERM_PROGRAM: "Apple_Terminal" },
    probeTimeoutMs: 50,
  });

  await Bun.sleep(100);
  await startTyping(terminal);

  const before = terminal.written().length;

  terminal.stdin.write(`k${ghosttyAnswers}m`);
  await Bun.sleep(80);

  expect(drawnSince(terminal, before)).toContain("km");
  await say(random);
  await Bun.sleep(100);

  expect(notificationsWritten(terminal)).toHaveLength(0);

  signals.emit("SIGTERM");
  await finished;
});

test("quitting before the probe finishes leaves no timer or subscription", async () => {
  const { terminal, signals, finished } = await startRunning({
    desktop: true,
    env: ghostty,
    probeTimeoutMs: 100,
  });

  signals.emit("SIGTERM");
  await finished;
  await Bun.sleep(150);
  await say(random).catch(() => undefined);
  await Bun.sleep(60);

  expect(terminal.written()).not.toContain(oscStart);
});

const iterm2Answers = "\x1bP>|iTerm2 3.5.0\x1b\\\x1b[?62;4c";

function osc9Written(terminal: { written(): string }) {
  return [...terminal.written().matchAll(/\x1b\]9;([^\x07]*)\x07/g)].map(
    (match) => match[1]!,
  );
}

test("iTerm2's answers, with no TERM_PROGRAM, lead to OSC 9 notifications of title: body", async () => {
  const { terminal, signals, finished } = await startRunning({
    desktop: true,
    probeTimeoutMs: 5000,
  });

  terminal.stdin.write(iterm2Answers);
  await Bun.sleep(30);
  await say(random, `<@${me}> hello`);
  await waitFor(() => osc9Written(terminal).length === 1);

  expect(osc9Written(terminal)[0]).toMatch(/^#random · .+: @\S+ hello$/);
  expect(terminal.written()).not.toContain(oscStart);
  expect(terminal.written()).not.toContain("aren't supported");

  signals.emit("SIGTERM");
  await finished;
});

test("TERM_PROGRAM=iTerm.app with no name also leads to OSC 9", async () => {
  const { terminal, signals, finished } = await startRunning({
    desktop: true,
    env: { TERM_PROGRAM: "iTerm.app" },
  });

  await say(random);
  await waitFor(() => osc9Written(terminal).length === 1);

  expect(terminal.written()).not.toContain(oscStart);

  signals.emit("SIGTERM");
  await finished;
});

test("the terminal's name wins over TERM_PROGRAM: Ghostty's name under iTerm.app gets OSC 777", async () => {
  const { terminal, signals, finished } = await startRunning({
    desktop: true,
    env: { TERM_PROGRAM: "iTerm.app" },
    probeTimeoutMs: 5000,
  });

  terminal.stdin.write(ghosttyAnswers);
  await Bun.sleep(30);
  await say(random);
  await waitFor(() => notificationsWritten(terminal).length === 1);

  expect(osc9Written(terminal)).toEqual([]);

  signals.emit("SIGTERM");
  await finished;
});

test("control characters are removed from an OSC 9 notification", async () => {
  const { terminal, signals, finished } = await startRunning({
    desktop: true,
    env: { TERM_PROGRAM: "iTerm.app" },
  });

  await say(random, `<@${me}> a\x1b]0;evil\x07b\x9bc\x7fd e\x00f`);
  await waitFor(() => terminal.written().includes("\x1b]9;"));

  const written = terminal.written();
  const start = written.indexOf("\x1b]9;");
  const sequence = written.slice(start, written.indexOf("\x07", start) + 1);

  expect(sequence).toMatch(/^\x1b\]9;[^\x00-\x1a\x1c-\x1f\x7f-\x9f]*\x07$/);
  expect(sequence).toContain("a]0;evilbcd ef");

  signals.emit("SIGTERM");
  await finished;
});

test("OSC 9 text that would read as a numbered sub-command has its semicolon replaced", async () => {
  const { terminal, signals, finished } = await startRunning({
    desktop: true,
    env: { TERM_PROGRAM: "iTerm.app" },
    otherName: "4;x",
  });

  await harness.sendEvents({
    event: {
      type: "message",
      channel: "D0C0F7S8Y",
      channel_type: "im",
      user: other,
      text: "hi",
      ts: "1700000100.000002",
    },
  });
  await waitFor(() => osc9Written(terminal).length === 1);

  expect(osc9Written(terminal)[0]).toBe("4,x: hi");

  signals.emit("SIGTERM");
  await finished;
});
