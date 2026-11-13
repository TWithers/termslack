import { expect, test } from "bun:test";
import {
  createDesktopNotifier,
  maxBodyLength,
  type NotifierProcess,
  notificationCommand,
} from "../src/ui/app/desktopNotifications";

const awkward = [
  `He said "hi" and 'bye'`,
  "back\\slash \\n \\\\",
  "line one\nline two\r\nline three",
  "-e display dialog",
  `" & do shell script "touch /tmp/pwned" & "`,
  "$(touch /tmp/pwned) `id` ; rm -rf ~",
];

test.each(awkward)("macOS passes %j as arguments, not script text", (text) => {
  const command = notificationCommand("darwin", text, text)!;

  expect(command.slice(0, 7)).toEqual([
    "osascript",
    "-e",
    "on run argv",
    "-e",
    "display notification (item 2 of argv) with title (item 1 of argv)",
    "-e",
    "end run",
  ]);
  expect(command.slice(7)).toEqual(["--", text, text]);
});

test.each(awkward)("Linux passes %j after --", (text) => {
  expect(notificationCommand("linux", text, text)).toEqual([
    "notify-send",
    "--",
    text,
    text,
  ]);
});

test("other platforms have no command", () => {
  expect(notificationCommand("win32", "a", "b")).toBeUndefined();
});

function fakeProcess() {
  let finish!: (code: number) => void;
  const killed: boolean[] = [];
  const process: NotifierProcess = {
    exited: new Promise<number>((resolve) => (finish = resolve)),
    kill: () => void killed.push(true),
  };

  return { process, finish, killed };
}

test("a missing tool or unsupported platform makes the notifier unavailable", () => {
  const missing = createDesktopNotifier({
    platform: "linux",
    which: () => null,
  });
  const unsupported = createDesktopNotifier({
    platform: "win32",
    which: () => "/x",
  });

  expect(missing.unavailable).toContain("notify-send");
  expect(unsupported.unavailable).toContain("win32");
});

test("the tool is looked up once, up front, and each show spawns it without waiting", () => {
  const looked: string[] = [];
  const spawned: string[][] = [];
  const notifier = createDesktopNotifier({
    platform: "linux",
    which: (tool) => (looked.push(tool), "/usr/bin/notify-send"),
    spawn: (command) => (spawned.push(command), fakeProcess().process),
  });

  notifier.show("t", "b");
  notifier.show("t2", "b2");

  expect(looked).toEqual(["notify-send"]);
  expect(spawned).toEqual([
    ["notify-send", "--", "t", "b"],
    ["notify-send", "--", "t2", "b2"],
  ]);
  expect(notifier.unavailable).toBeUndefined();
});

test("a failing command is reported once and never throws", async () => {
  const notes: string[] = [];
  const notifier = createDesktopNotifier({
    platform: "darwin",
    which: () => "/usr/bin/osascript",
    spawn: () => {
      const { process, finish } = fakeProcess();

      finish(1);

      return process;
    },
    onFailure: (note) => notes.push(note),
  });

  notifier.show("a", "b");
  notifier.show("a", "b");
  await Bun.sleep(10);

  expect(notes).toHaveLength(1);
  expect(notes[0]).toContain("osascript exited with 1");
});

test("a command that can't start is reported and swallowed", () => {
  const notes: string[] = [];
  const notifier = createDesktopNotifier({
    platform: "linux",
    which: () => "/x",
    spawn: () => {
      throw new Error("spawn failed");
    },
    onFailure: (note) => notes.push(note),
  });

  expect(() => notifier.show("a", "b")).not.toThrow();
  expect(notes[0]).toContain("spawn failed");
});

test("a command that hangs is killed after the timeout", async () => {
  const notes: string[] = [];
  const { process, killed } = fakeProcess();
  const notifier = createDesktopNotifier({
    platform: "linux",
    which: () => "/x",
    spawn: () => process,
    timeoutMs: 20,
    onFailure: (note) => notes.push(note),
  });

  notifier.show("a", "b");
  await Bun.sleep(60);

  expect(killed).toEqual([true]);
  expect(notes[0]).toContain("timed out");
});

test("the body limit is a sensible length", () => {
  expect(maxBodyLength).toBeGreaterThan(50);
});
