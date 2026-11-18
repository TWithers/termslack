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
import type { NotificationLevel } from "../src/config/config";
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
  notifications,
  windowMs = 20,
  intervalMs,
  unknownNotifications,
  env = {},
  probeTimeoutMs = 20,
  history,
  otherName,
}: {
  notifications?: NotificationLevel;
  windowMs?: number;
  intervalMs?: number;
  unknownNotifications?: string;
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
      notifications,
      unknownNotifications,
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
    notifications: "off",
  });

  await say(random);
  await Bun.sleep(100);

  expect(bells).toEqual([]);
  expect(terminal.written()).not.toContain("\x07");

  signals.emit("SIGTERM");
  await finished;
});

test("an unknown notifications value is named once in the status line", async () => {
  const { terminal, signals, finished } = await startRunning({
    notifications: "desktop",
    unknownNotifications: "loud",
  });

  await waitFor(() =>
    terminal.written().includes('Unknown notifications "loud"'),
  );

  signals.emit("SIGTERM");
  await finished;
});

test("with notifications off no probe is written and no notice shows", async () => {
  const { terminal, signals, finished, bells } = await startRunning({
    notifications: "off",
    env: { TERM_PROGRAM: "Apple_Terminal" },
  });

  await say(random, `<@${me}> plain`);
  await Bun.sleep(100);

  expect(bells).toEqual([]);
  expect(terminal.written()).not.toContain(oscStart);
  expect(terminal.written()).not.toContain("aren't supported");

  signals.emit("SIGTERM");
  await finished;
});

test("with notifications on bell the bell rings and no probe is written", async () => {
  const { terminal, signals, finished, bells } = await startRunning({
    notifications: "bell",
    env: ghostty,
  });

  await say(random, `<@${me}> plain`);
  await waitFor(() => bells.length === 1);

  expect(terminal.written()).not.toContain(oscStart);
  expect(terminal.written()).not.toContain("\x1b]99;");

  signals.emit("SIGTERM");
  await finished;
});

test("in desktop notifications the bell rings until the probe finishes, then no more", async () => {
  const { terminal, signals, finished, bells } = await startRunning({
    notifications: "desktop",
    env: ghostty,
    probeTimeoutMs: 5000,
    windowMs: 20,
    intervalMs: 50,
  });

  await say(random, `<@${me}> early`);
  await waitFor(() => bells.length === 1);
  expect(notificationsWritten(terminal)).toHaveLength(0);

  terminal.stdin.write("\x1bP>|ghostty 1.4.0\x1b\\\x1b[?62;22;52c");
  await Bun.sleep(100);
  await say(random, `<@${me}> later`);
  await waitFor(() => notificationsWritten(terminal).length === 1);
  await Bun.sleep(100);

  expect(bells).toHaveLength(1);

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

test("desktop notifications are not sent at the default level", async () => {
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
    notifications: "bell",
    env: { TERM_PROGRAM: "Apple_Terminal" },
  });

  await Bun.sleep(50);

  expect(terminal.written()).not.toContain("aren't supported");

  signals.emit("SIGTERM");
  await finished;
});

test("under Ghostty a notifying message writes one OSC 777 notification with conversation, author and plain text", async () => {
  const { terminal, signals, finished, bells } = await startRunning({
    notifications: "desktop",
    env: ghostty,
  });

  await say(random, `*bold* hey <@${me}> -- "quoted"\nsecond line`);
  await waitFor(() => notificationsWritten(terminal).length === 1);

  const [shown] = notificationsWritten(terminal);

  expect(bells).toEqual([]);
  expect(shown!.title).toStartWith("#random · ");
  expect(shown!.title).not.toContain("U222222222");
  expect(shown!.body).toMatch(/^bold hey @\S+ -- "quoted" second line$/);
  expect(terminal.written()).not.toContain("aren't supported");

  signals.emit("SIGTERM");
  await finished;
});

test("a direct message is titled by the person who wrote", async () => {
  const { terminal, signals, finished } = await startRunning({
    notifications: "desktop",
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
    notifications: "desktop",
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
    notifications: "desktop",
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
    notifications: "desktop",
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
    notifications: "desktop",
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
    notifications: "desktop",
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
    notifications: "desktop",
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

const probeBytes = "\x1b]99;i=termslack-probe:p=?;\x1b\\\x1b[>0q\x1b[c";
const ghosttyAnswers = "\x1bP>|ghostty 1.4.0\x1b\\\x1b[?62;22;52c";
const soloAnswer = "\x1b[?64;1;2;6;22c";

test.each([
  ["desktop", "desktop"],
  ["bell", "bell"],
  ["off", "off"],
] as const)(
  "the probe's bytes are written when notifications are %s",
  async (_, notifications) => {
    const { terminal, signals, finished } = await startRunning({
      notifications,
    });

    expect(terminal.written().includes(probeBytes)).toBe(
      notifications === "desktop",
    );

    signals.emit("SIGTERM");
    await finished;
  },
);

test("the probe is written once, after the reporting setup", async () => {
  const { terminal, signals, finished } = await startRunning({
    notifications: "desktop",
  });
  const written = terminal.written();

  expect(written.split(probeBytes)).toHaveLength(2);
  expect(written.indexOf(probeBytes)).toBeGreaterThan(written.indexOf(focusOn));

  signals.emit("SIGTERM");
  await finished;
});

test("Ghostty's answers, with no TERM_PROGRAM, lead to OSC 777 notifications", async () => {
  const { terminal, signals, finished } = await startRunning({
    notifications: "desktop",
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
    notifications: "desktop",
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
    notifications: "desktop",
    probeTimeoutMs: 5000,
  });

  terminal.stdin.write(soloAnswer);
  await waitFor(() => terminal.written().includes("aren't supported"));

  signals.emit("SIGTERM");
  await finished;
});

test("with no answer before the timeout, TERM_PROGRAM decides", async () => {
  const { terminal, signals, finished } = await startRunning({
    notifications: "desktop",
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
    notifications: "desktop",
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
    notifications: "desktop",
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
    notifications: "desktop",
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
    notifications: "desktop",
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
    notifications: "desktop",
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
    notifications: "desktop",
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
    notifications: "desktop",
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
    notifications: "desktop",
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
    notifications: "desktop",
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
    notifications: "desktop",
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

const kittyAnswer =
  "\x1b]99;i=termslack-probe:p=?;a=focus:o=always,unfocused,invisible:p=title,body:u=0,1,2\x1b\\";
const kittyAnswerWithoutUrgency =
  "\x1b]99;i=termslack-probe:p=?;a=focus:o=always:x=whatever:bogus:p=title,body\x1b\\";
const da1 = "\x1b[?62;22c";

type Osc99Part = { params: Record<string, string>; text: string };

function osc99Written(terminal: { written(): string }): Osc99Part[] {
  return [
    ...terminal.written().matchAll(/\x1b\]99;([^;\x1b]*);([^\x1b]*)\x1b\\/g),
  ]
    .filter((match) => !match[1]!.includes("p=?") && match[2] !== "")
    .map((match) => ({
      params: Object.fromEntries(
        match[1]!.split(":").map((pair) => pair.split("=") as [string, string]),
      ),
      text: Buffer.from(match[2]!, "base64").toString("utf8"),
    }));
}

async function sendDirectMessage(text: string) {
  await harness.sendEvents({
    event: {
      type: "message",
      channel: "D012AB3CD",
      channel_type: "im",
      user: other,
      text,
      ts: "1700000200.000001",
    },
  });
}

test("an OSC 99 answer leads to a two-part base64 notification with title and body", async () => {
  const { terminal, signals, finished } = await startRunning({
    notifications: "desktop",
    probeTimeoutMs: 5000,
  });

  terminal.stdin.write(kittyAnswer + da1);
  await Bun.sleep(30);
  await say(random, `<@${me}> héllo`);
  await waitFor(() => osc99Written(terminal).length === 2);

  const [title, body] = osc99Written(terminal);

  expect(title!.params).toEqual({
    i: "termslack-C061EG9T2",
    d: "0",
    e: "1",
  });
  expect(title!.text).toStartWith("#random · ");
  expect(body!.params).toEqual({
    i: "termslack-C061EG9T2",
    p: "body",
    e: "1",
  });
  expect(body!.text).toMatch(/^@\S+ héllo$/);
  expect(terminal.written()).not.toContain(oscStart);
  expect(terminal.written()).not.toContain("aren't supported");

  signals.emit("SIGTERM");
  await finished;
});

test("Solo's answer with TERM_PROGRAM=solo leads to OSC 99 without urgency", async () => {
  const { terminal, signals, finished } = await startRunning({
    notifications: "desktop",
    env: { TERM_PROGRAM: "solo" },
    probeTimeoutMs: 5000,
  });

  terminal.stdin.write(soloAnswer);
  await Bun.sleep(30);
  await sendDirectMessage("hi solo");
  await waitFor(() => osc99Written(terminal).length === 2);

  const [title, body] = osc99Written(terminal);

  expect(title!.params).toEqual({
    i: "termslack-D012AB3CD",
    d: "0",
    e: "1",
  });
  expect(body!.text).toBe("hi solo");

  signals.emit("SIGTERM");
  await finished;
});

test("TERM_PROGRAM=solo with no answer at all still leads to OSC 99", async () => {
  const { terminal, signals, finished } = await startRunning({
    notifications: "desktop",
    env: { TERM_PROGRAM: "solo" },
  });

  await say(random);
  await waitFor(() => osc99Written(terminal).length === 2);

  signals.emit("SIGTERM");
  await finished;
});

test("a direct message gets u=2 when the answer listed 2, a mention never does", async () => {
  const { terminal, signals, finished } = await startRunning({
    notifications: "desktop",
    probeTimeoutMs: 5000,
  });

  terminal.stdin.write(kittyAnswer + da1);
  await Bun.sleep(30);
  await say(random);
  await waitFor(() => osc99Written(terminal).length === 2);
  await sendDirectMessage("psst");
  await waitFor(() => osc99Written(terminal).length === 4);

  const [mention, , dm] = osc99Written(terminal);

  expect(mention!.params.u).toBeUndefined();
  expect(dm!.params).toEqual({
    i: "termslack-D012AB3CD",
    d: "0",
    e: "1",
    u: "2",
  });

  signals.emit("SIGTERM");
  await finished;
});

test("unknown keys and malformed pairs are ignored, and an answer without u gives no urgency", async () => {
  const { terminal, signals, finished } = await startRunning({
    notifications: "desktop",
    probeTimeoutMs: 5000,
  });

  terminal.stdin.write(kittyAnswerWithoutUrgency + da1);
  await Bun.sleep(30);
  await sendDirectMessage("psst");
  await waitFor(() => osc99Written(terminal).length === 2);

  expect(osc99Written(terminal)[0]!.params.u).toBeUndefined();

  signals.emit("SIGTERM");
  await finished;
});

test("an answer without p still works", async () => {
  const { terminal, signals, finished } = await startRunning({
    notifications: "desktop",
    probeTimeoutMs: 5000,
  });

  terminal.stdin.write("\x1b]99;i=termslack-probe:p=?;u=0,1,2\x07" + da1);
  await Bun.sleep(30);
  await sendDirectMessage("psst");
  await waitFor(() => osc99Written(terminal).length === 2);

  expect(osc99Written(terminal)[0]!.params.u).toBe("2");

  signals.emit("SIGTERM");
  await finished;
});

test("the OSC 99 answer wins over the terminal's name", async () => {
  const { terminal, signals, finished } = await startRunning({
    notifications: "desktop",
    probeTimeoutMs: 5000,
  });

  terminal.stdin.write(kittyAnswer + ghosttyAnswers);
  await Bun.sleep(30);
  await say(random);
  await waitFor(() => osc99Written(terminal).length === 2);

  expect(notificationsWritten(terminal)).toEqual([]);

  signals.emit("SIGTERM");
  await finished;
});

test("OSC 99 control characters are removed before encoding", async () => {
  const { terminal, signals, finished } = await startRunning({
    notifications: "desktop",
    env: { TERM_PROGRAM: "solo" },
  });

  await say(random, `<@${me}> a\x1b]0;evil\x07b\x9bc\x00d`);
  await waitFor(() => osc99Written(terminal).length === 2);

  expect(osc99Written(terminal)[1]!.text).toContain("a]0;evilbcd");
  expect(osc99Written(terminal)[1]!.text).not.toMatch(/[\x00-\x1f\x7f-\x9f]/);

  signals.emit("SIGTERM");
  await finished;
});

test("the OSC 99 answer is removed from typed text, whole, split, and ended by BEL or ST", async () => {
  const { terminal, signals, finished } = await startRunning({
    notifications: "desktop",
    probeTimeoutMs: 5000,
  });

  await startTyping(terminal);

  const before = terminal.written().length;

  for (const piece of [
    "a\x1b]99;i=termslack-probe:p=?;a=fo",
    "cus:u=0,1\x1b",
    "\\b\x1b]99;i=termslack-probe:p=?;u=2\x07c\x1b]99;",
    "i=termslack-probe:p=?;\x1b\\d",
  ]) {
    terminal.stdin.write(piece);
    await Bun.sleep(15);
  }

  await Bun.sleep(50);

  expect(drawnSince(terminal, before)).toContain("abcd");
  expect(drawnSince(terminal, before)).not.toContain("termslack-probe");
  expect(drawnSince(terminal, before)).not.toContain("a=focus");

  signals.emit("SIGTERM");
  await finished;
});

const kittyReportAnswer =
  "\x1b]99;i=termslack-probe:p=?;a=focus,report:o=always,unfocused,invisible:p=title,body:u=0,1,2\x1b\\";
const clickReport = (conversationId: string, end = "\x1b\\") =>
  `\x1b]99;i=termslack-${conversationId};${end}`;

async function startKitty() {
  const running = await startRunning({
    notifications: "desktop",
    probeTimeoutMs: 5000,
    intervalMs: 10,
  });

  running.terminal.stdin.write(kittyReportAnswer + da1);
  await Bun.sleep(30);

  return running;
}

test("an answer listing report leads to OSC 99 with focus and report actions", async () => {
  const { terminal, signals, finished } = await startKitty();

  await say(random, `<@${me}> one`);
  await waitFor(() => osc99Written(terminal).length === 2);
  await say(random, `<@${me}> two`);
  await waitFor(() => osc99Written(terminal).length === 4);
  await say(general, `<@${me}> three`);
  await waitFor(() => osc99Written(terminal).length === 6);

  const titles = osc99Written(terminal).filter((part) => part.params.d);

  expect(titles[0]!.params).toEqual({
    i: "termslack-C061EG9T2",
    a: "focus,report",
    d: "0",
    e: "1",
  });
  expect(titles.map((title) => title.params.i)).toEqual([
    "termslack-C061EG9T2",
    "termslack-C061EG9T2",
    "termslack-C012AB3CD",
  ]);

  signals.emit("SIGTERM");
  await finished;
});

test("an answer without report still gets plain OSC 99", async () => {
  const { terminal, signals, finished } = await startRunning({
    notifications: "desktop",
    probeTimeoutMs: 5000,
  });

  terminal.stdin.write(kittyAnswer + da1);
  await Bun.sleep(30);
  await say(random);
  await waitFor(() => osc99Written(terminal).length === 2);

  expect(osc99Written(terminal)[0]!.params.a).toBeUndefined();

  signals.emit("SIGTERM");
  await finished;
});

test("a click report for a notified channel mention opens that channel", async () => {
  const { terminal, signals, finished } = await startKitty();

  await say(random, `<@${me}> kitty-marker`);
  await waitFor(() => osc99Written(terminal).length === 2);

  const before = terminal.written().length;

  terminal.stdin.write(clickReport(random));
  await waitFor(() => drawnSince(terminal, before).includes("─ #random ─"));

  expect(drawnSince(terminal, before)).not.toContain("termslack-");

  signals.emit("SIGTERM");
  await finished;
});

test("a click report for a notified thread reply opens the conversation and its thread", async () => {
  const { terminal, signals, finished } = await startKitty();

  await say(random, `<@${me}> reply-marker`, "1700000000.000900");
  await waitFor(() => osc99Written(terminal).length === 2);

  const before = terminal.written().length;

  terminal.stdin.write(clickReport(random));
  await waitFor(() => drawnSince(terminal, before).includes(" Thread "));
  await waitFor(() => drawnSince(terminal, before).includes("reply-marker"));

  signals.emit("SIGTERM");
  await finished;
});

test("a click report for a burst opens the newest message's conversation", async () => {
  const { terminal, signals, finished } = await startKitty();

  await say(general, `<@${me}> earlier`);
  await say(random, `<@${me}> newest-marker`);
  await waitFor(() => osc99Written(terminal).length === 2);

  const before = terminal.written().length;

  terminal.stdin.write(clickReport(random));
  await waitFor(() => drawnSince(terminal, before).includes("─ #random ─"));

  signals.emit("SIGTERM");
  await finished;
});

test("a click report with an unknown identifier does nothing", async () => {
  const { terminal, signals, finished } = await startKitty();

  await say(random, `<@${me}> unknown-marker`);
  await waitFor(() => osc99Written(terminal).length === 2);

  const before = terminal.written().length;

  terminal.stdin.write(clickReport("C0NOSUCH00"));
  await Bun.sleep(150);

  expect(drawnSince(terminal, before)).not.toContain("─ #random ─");

  signals.emit("SIGTERM");
  await finished;
});

test("click reports never reach the input box, whole or split", async () => {
  const { terminal, signals, finished } = await startKitty();

  await startTyping(terminal);

  const before = terminal.written().length;

  for (const piece of [
    `a${clickReport(random)}b${clickReport(general, "\x07")}c`,
    "\x1b]99;i=termslack-C0",
    "61EG9T2;",
    "\x1b",
    "\\d\x1b]99;i=termslack-C061EG9T2;1\x1b\\e",
  ]) {
    terminal.stdin.write(piece);
    await Bun.sleep(15);
  }

  await Bun.sleep(50);

  expect(drawnSince(terminal, before)).toContain("abcde");
  expect(drawnSince(terminal, before)).not.toContain("termslack-");

  signals.emit("SIGTERM");
  await finished;
});

function closesWritten(terminal: { written(): string }): string[] {
  return [
    ...terminal.written().matchAll(/\x1b\]99;i=([^:;\x1b]*):p=close;\x1b\\/g),
  ].map((match) => match[1]!);
}

test("opening a conversation with a shown notification closes it once", async () => {
  const { terminal, signals, finished } = await startKitty();

  await say(random, `<@${me}> close-marker`);
  await waitFor(() => osc99Written(terminal).length === 2);

  expect(closesWritten(terminal)).toEqual([]);

  terminal.stdin.write(clickReport(random));
  await waitFor(() => closesWritten(terminal).length === 1);

  expect(closesWritten(terminal)).toEqual(["termslack-C061EG9T2"]);

  terminal.stdin.write(clickReport(random));
  await Bun.sleep(150);

  expect(closesWritten(terminal)).toHaveLength(1);

  signals.emit("SIGTERM");
  await finished;
});

test("opening a conversation that was never notified writes no close", async () => {
  const { terminal, signals, finished } = await startKitty();

  await say(random, `<@${me}> elsewhere-marker`);
  await waitFor(() => osc99Written(terminal).length === 2);

  terminal.stdin.write("\x1b[B\r");
  await Bun.sleep(150);

  expect(closesWritten(terminal)).not.toContain("termslack-C012AB3CD");

  signals.emit("SIGTERM");
  await finished;
});

test("regaining terminal window focus closes the open conversation's notification", async () => {
  const { terminal, signals, finished } = await startKitty();

  terminal.stdin.write(focusOut);
  await Bun.sleep(30);
  await say(general, `<@${me}> away-marker`);
  await waitFor(() => osc99Written(terminal).length === 2);

  expect(closesWritten(terminal)).toEqual([]);

  terminal.stdin.write(focusIn);
  await waitFor(() => closesWritten(terminal).length === 1);

  expect(closesWritten(terminal)).toEqual(["termslack-C012AB3CD"]);

  terminal.stdin.write(focusOut);
  await Bun.sleep(30);
  await say(general, `<@${me}> away-again`);
  await waitFor(() => osc99Written(terminal).length === 4);
  terminal.stdin.write(focusIn);
  await waitFor(() => closesWritten(terminal).length === 2);

  signals.emit("SIGTERM");
  await finished;
});

test("a notification for another conversation stays when focus returns", async () => {
  const { terminal, signals, finished } = await startKitty();

  terminal.stdin.write(focusOut);
  await Bun.sleep(30);
  await say(random, `<@${me}> other-marker`);
  await waitFor(() => osc99Written(terminal).length === 2);
  terminal.stdin.write(focusIn);
  await Bun.sleep(150);

  expect(closesWritten(terminal)).toEqual([]);

  signals.emit("SIGTERM");
  await finished;
});

test("terminals without clickable notifications never get a close", async () => {
  const { terminal, signals, finished } = await startRunning({
    notifications: "desktop",
    probeTimeoutMs: 5000,
    intervalMs: 10,
  });

  terminal.stdin.write(kittyAnswer + da1);
  await Bun.sleep(30);
  terminal.stdin.write(focusOut);
  await Bun.sleep(30);
  await say(general, `<@${me}> plain-marker`);
  await waitFor(() => osc99Written(terminal).length === 2);
  terminal.stdin.write(focusIn);
  await Bun.sleep(150);

  expect(terminal.written()).not.toContain("p=close");

  signals.emit("SIGTERM");
  await finished;
});

test("quitting closes every clickable notification still shown, before the terminal is restored", async () => {
  const { terminal, signals, finished } = await startKitty();

  await say(random, `<@${me}> left-one`);
  await waitFor(() => osc99Written(terminal).length === 2);
  await say(general, `<@${me}> left-two`);
  await waitFor(() => osc99Written(terminal).length === 4);

  terminal.stdin.write(clickReport(random));
  await waitFor(() => closesWritten(terminal).length === 1);

  signals.emit("SIGTERM");
  await finished;

  expect(closesWritten(terminal)).toEqual([
    "termslack-C061EG9T2",
    "termslack-C012AB3CD",
  ]);
  expect(terminal.written().lastIndexOf("p=close")).toBeLessThan(
    terminal.written().lastIndexOf(focusOff),
  );
});

test("a terminal without clickable notifications gets no close on quitting", async () => {
  const { terminal, signals, finished } = await startRunning({
    notifications: "desktop",
    probeTimeoutMs: 5000,
    intervalMs: 10,
  });

  terminal.stdin.write(kittyAnswer + da1);
  await Bun.sleep(30);
  await say(random, `<@${me}> plain-exit`);
  await waitFor(() => osc99Written(terminal).length === 2);

  signals.emit("SIGTERM");
  await finished;

  expect(terminal.written()).not.toContain("p=close");
});

const myMessage = [
  {
    type: "message",
    user: me,
    text: "my-own-words",
    ts: "1700000050.000001",
  },
];

function deletes() {
  return harness.slack.calls.filter((call) => call.method === "chat.delete");
}

test("a click report cancels a pending delete question, so y deletes nothing in the old conversation", async () => {
  const running = await startRunning({
    notifications: "desktop",
    probeTimeoutMs: 5000,
    intervalMs: 10,
    history: myMessage,
  });
  const { terminal, signals, finished } = running;

  terminal.stdin.write(kittyReportAnswer + da1);
  await Bun.sleep(30);
  await say(random, `<@${me}> question-marker`);
  await waitFor(() => osc99Written(terminal).length === 2);

  terminal.stdin.write("\t");
  await Bun.sleep(50);
  terminal.stdin.write("d");
  await waitFor(() => drawnSince(terminal, 0).includes("Delete this message?"));

  const before = terminal.written().length;

  terminal.stdin.write(clickReport(random));
  await waitFor(() => drawnSince(terminal, before).includes("─ #random ─"));

  const after = terminal.written().length;

  terminal.stdin.write("y");
  await Bun.sleep(150);

  expect(deletes()).toHaveLength(0);
  expect(drawnSince(terminal, after)).not.toContain("Delete this message?");

  signals.emit("SIGTERM");
  await finished;
});

test("a click report closes an open popup and opens the conversation", async () => {
  const { terminal, signals, finished } = await startKitty();

  await say(random, `<@${me}> popup-marker`);
  await waitFor(() => osc99Written(terminal).length === 2);

  terminal.stdin.write("?");
  await waitFor(() => drawnSince(terminal, 0).includes("Everywhere"));
  await Bun.sleep(50);

  const before = terminal.written().length;

  terminal.stdin.write(clickReport(random));
  await waitFor(() => drawnSince(terminal, before).includes("─ #random ─"));

  const after = terminal.written().length;

  terminal.stdin.write("?");
  await waitFor(() => drawnSince(terminal, after).includes("Everywhere"));

  signals.emit("SIGTERM");
  await finished;
});

test("an XTVERSION answer split right after ESC P during the probe is removed and Ghostty is detected", async () => {
  const { terminal, signals, finished } = await startRunning({
    notifications: "desktop",
    probeTimeoutMs: 5000,
    intervalMs: 10,
  });

  await startTyping(terminal);

  const before = terminal.written().length;

  for (const piece of ["x\x1b", "P", ">|ghostty 1.4.0\x1b\\\x1b[?62;22cy"]) {
    terminal.stdin.write(piece);
    await Bun.sleep(15);
  }

  await Bun.sleep(50);

  expect(drawnSince(terminal, before)).toContain("xy");
  expect(drawnSince(terminal, before)).not.toContain("ghostty");

  await say(general, `<@${me}> split-marker`);
  await waitFor(() => terminal.written().includes("\x1b]777;notify;"));

  signals.emit("SIGTERM");
  await finished;
});

test("answers split after ESC ], ESC ]9 or ESC [ during the probe are removed", async () => {
  const { terminal, signals, finished } = await startRunning({
    notifications: "desktop",
    probeTimeoutMs: 5000,
  });

  await startTyping(terminal);

  const before = terminal.written().length;

  for (const piece of [
    "a\x1b]",
    "99;i=termslack-probe:p=?;a=focus\x1b\\b\x1b",
    "[?62;22cc",
  ]) {
    terminal.stdin.write(piece);
    await Bun.sleep(15);
  }

  await Bun.sleep(50);

  expect(drawnSince(terminal, before)).toContain("abc");
  expect(drawnSince(terminal, before)).not.toContain("termslack-probe");

  signals.emit("SIGTERM");
  await finished;
});

test("a lone Escape typed after the probe finished is not held", async () => {
  const { terminal, finished } = await startRunning({
    notifications: "desktop",
    probeTimeoutMs: 5000,
  });

  terminal.stdin.write(ghosttyAnswers);
  await Bun.sleep(30);
  await startTyping(terminal);

  terminal.stdin.write("\x1b");
  await Bun.sleep(80);
  terminal.stdin.write("q");

  const quit = await Promise.race([
    finished.then(() => true),
    Bun.sleep(1000).then(() => false),
  ]);

  expect(quit).toBe(true);
});

test("an Escape held during the probe is released when the probe finishes", async () => {
  const { terminal, finished } = await startRunning({
    notifications: "desktop",
    probeTimeoutMs: 5000,
  });

  await startTyping(terminal);

  terminal.stdin.write("\x1b");
  await Bun.sleep(50);
  terminal.stdin.write(ghosttyAnswers);
  await Bun.sleep(80);
  terminal.stdin.write("q");

  const quit = await Promise.race([
    finished.then(() => true),
    Bun.sleep(1000).then(() => false),
  ]);

  expect(quit).toBe(true);
});
