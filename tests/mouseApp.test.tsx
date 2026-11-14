import { afterEach, describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import {
  type AppHarness,
  keys,
  seedWorkspace,
  sgrMouse,
  startAppHarness,
} from "./support/appHarness";
import { fakeTerminal } from "./support/fakeTerminal";
import { statusLine } from "./support/panes";
import { waitFor } from "./support/fakeSlack";
import {
  type SessionHarness,
  startSessionHarness,
} from "./support/sessionHarness";
import { mouseReportingOff, mouseReportingOn } from "../src/ui/app/mouse";
import { runApp } from "../src/ui/app/run";

let app: AppHarness | undefined;
let session: SessionHarness | undefined;

afterEach(async () => {
  await app?.stop();
  await session?.stop();
  app = undefined;
  session = undefined;
});

const parentTs = "1600000000.000001";

const history = [
  {
    type: "message",
    user: "U222222222",
    text: "plain text",
    ts: "1600000100.000001",
  },
  {
    type: "message",
    user: "U123ABC456",
    text: "parent text",
    ts: parentTs,
    thread_ts: parentTs,
    reply_count: 1,
  },
];

const replies = [
  history[1],
  {
    type: "message",
    user: "U222222222",
    text: "first reply",
    ts: "1600000010.000001",
    thread_ts: parentTs,
  },
];

const hints = {
  sidebar: "j/k move",
  messages: "i write",
  input: "Enter send",
  thread: "Esc close thread",
  threadInput: "Ctrl+T also send",
};

/** The message pane's status line (columns 32 to 96 of 160, where the thread pane starts) and the thread pane's. */
const messagesStatus = () => statusLine(app!.screen(), 32, 96);
const threadStatus = () => statusLine(app!.screen(), 96);

/** Which pane has focus, read from the key hints on the status line and the thread pane's border. */
function focused() {
  const thread = threadStatus();
  const bar = messagesStatus();

  if (thread.includes(hints.thread)) {
    return "thread";
  }

  if (thread.includes(hints.threadInput)) {
    return "threadInput";
  }

  if (bar.includes(hints.input)) {
    return "input";
  }

  return bar.includes(hints.messages) ? "messages" : "sidebar";
}

async function start() {
  app = await startAppHarness({
    columns: 160,
    rows: 30,
    prepare: (slack) => {
      slack.respond("conversations.history", () => ({
        ok: true,
        messages: [...history].reverse(),
        has_more: false,
      }));
      slack.respond("conversations.replies", () => ({
        ok: true,
        messages: replies,
        has_more: false,
      }));
    },
  });
  await app.waitForScreen("#general", 5000);
  await app.press(keys.enter);
  await app.waitForScreen("plain text");
  await waitFor(() => app!.session.currentUserId);
  await app.press(keys.tab);
}

test("a click on the message pane, its input box and the sidebar moves focus there", async () => {
  await start();

  expect(focused()).toBe("messages");

  await app!.click(60, 10);
  expect(focused()).toBe("messages");

  await app!.click(60, 28);
  expect(focused()).toBe("input");

  await app!.click(60, 10);
  expect(focused()).toBe("messages");

  await app!.click(5, 20);
  expect(focused()).toBe("sidebar");
});

test("a click on the thread pane and its input box moves focus there", async () => {
  await start();
  await app!.press("k");
  await app!.press(keys.enter);
  await app!.waitForScreen("first reply");
  await app!.click(60, 10);
  expect(focused()).toBe("messages");

  await app!.click(140, 10);
  expect(focused()).toBe("thread");

  await app!.click(140, 28);
  expect(focused()).toBe("threadInput");

  await app!.click(60, 28);
  expect(focused()).toBe("input");
});

test("clicking with other buttons does nothing", async () => {
  await start();
  expect(focused()).toBe("messages");

  await app!.mouse(sgrMouse(2, 5, 5, "M"));
  await app!.mouse(sgrMouse(1, 5, 5, "M"));
  await app!.mouse(sgrMouse(64, 5, 5, "M"));
  await app!.mouse(sgrMouse(35, 5, 5, "M"));
  expect(focused()).toBe("messages");
});

test("a click on an input box puts the cursor at the end of the draft", async () => {
  await start();
  await app!.press("i");
  await app!.press("hello");
  await app!.press(keys.left);
  await app!.press(keys.left);
  await app!.click(60, 10);
  await app!.click(60, 28);
  await app!.press("!");

  expect(app!.screen()).toContain("hello!");
});

async function startRunning() {
  session = await startSessionHarness({ prepare: seedWorkspace });

  const terminal = fakeTerminal();
  const signals = new EventEmitter();
  const finished = runApp(
    { session: session.session, workspaceName: "Acme" },
    {
      signals,
      stdout: terminal.stdout,
      stdin: terminal.stdin as unknown as NodeJS.ReadStream,
    },
  );

  await waitFor(() => terminal.written().includes("● connected"));
  await waitFor(() => session!.session.listingHealth().people === "loaded");
  await waitFor(
    () => session!.session.listingHealth().conversations === "loaded",
  );
  await Bun.sleep(50);

  return { terminal, signals, finished };
}

test.each(["q", "ctrlC", "SIGINT", "SIGTERM"] as const)(
  "mouse reporting is turned on at start and off again when leaving by %s",
  async (leave) => {
    const { terminal, signals, finished } = await startRunning();

    expect(terminal.written()).toContain(mouseReportingOn);
    expect(terminal.written()).toContain("\x1b[?1003h");
    expect(terminal.written()).not.toContain(mouseReportingOff);

    if (leave === "q") {
      terminal.stdin.write("q");
    } else if (leave === "ctrlC") {
      terminal.stdin.write("\x03");
    } else {
      signals.emit(leave);
    }

    await finished;

    expect(terminal.written().lastIndexOf(mouseReportingOff)).toBeGreaterThan(
      terminal.written().lastIndexOf(mouseReportingOn),
    );
    expect(terminal.written()).toContain("\x1b[?1003l");
  },
);

test("mouse reporting is also turned off if the process exits some other way", async () => {
  const before = process.listenerCount("exit");
  const { terminal, signals, finished } = await startRunning();
  const exitHandlers = process.listeners("exit");

  expect(process.listenerCount("exit")).toBe(before + 1);

  const write = terminal.written().length;

  (exitHandlers.at(-1) as () => void)();
  expect(terminal.written().slice(write)).toContain(mouseReportingOff);
  expect(terminal.written().slice(write)).toContain("\x1b[?1003l");

  signals.emit("SIGTERM");
  await finished;
});

test("a click while typing adds nothing to the draft, even split across reads", async () => {
  const { terminal, signals, finished } = await startRunning();

  terminal.stdin.write("\r");
  await Bun.sleep(100);
  terminal.stdin.write("\t");
  await Bun.sleep(50);
  terminal.stdin.write("i");
  await Bun.sleep(50);

  const before = terminal.written().length;

  terminal.stdin.write(`a${sgrMouse(0, 40, 20, "M")}b`);
  terminal.stdin.write(sgrMouse(0, 40, 20, "m"));
  terminal.stdin.write("c\x1b[<0;4");
  terminal.stdin.write("1;21Md");
  await Bun.sleep(80);

  const drawn = Bun.stripANSI(terminal.written().slice(before));

  expect(drawn).toContain("abcd");
  expect(drawn).not.toContain("[<");
  expect(drawn).not.toContain("40;20");

  signals.emit("SIGTERM");
  await finished;
});

test("through stdin, a click on the input box focuses it for typing", async () => {
  const { terminal, signals, finished } = await startRunning();

  terminal.stdin.write("\r");
  await Bun.sleep(100);
  terminal.stdin.write(sgrMouse(0, 60, 27, "M"));
  terminal.stdin.write(sgrMouse(0, 60, 27, "m"));
  await Bun.sleep(50);

  const before = terminal.written().length;

  terminal.stdin.write("xyz");
  await Bun.sleep(80);

  expect(Bun.stripANSI(terminal.written().slice(before))).toContain("xyz");

  signals.emit("SIGTERM");
  await finished;
});

describe("sidebar clicks", () => {
  const sidebarRows = () =>
    app!
      .screen()
      .split("\n")
      .map((line) => line.slice(0, 32).trimEnd());
  const rowOf = (text: string) =>
    sidebarRows().findIndex((line) => line.includes(text));

  test("a click on an entry opens it, selects it and leaves focus in the sidebar", async () => {
    await start();
    await app!.click(5, 20);

    const row = rowOf("#random");

    expect(row).toBeGreaterThan(-1);
    await app!.click(5, row);
    await app!.waitForScreen("▌ #random");

    expect(focused()).toBe("sidebar");
    expect(sidebarRows()[row]).toContain("›");
  });

  test("a click on a section heading collapses and expands it", async () => {
    await start();
    await app!.click(5, 20);

    const row = rowOf("Channels");

    await app!.click(5, row);
    await waitFor(() => rowOf("#random") === -1 || rowOf("#random") > row + 1);
    expect(sidebarRows()[row]).toContain("›");
    expect(focused()).toBe("sidebar");

    await app!.click(5, row);
    await waitFor(() => rowOf("#random") === row + 2);
  });

  test("a click on a row with nothing on it does nothing but focus the sidebar", async () => {
    await start();
    expect(focused()).toBe("messages");

    await app!.click(5, 27);

    expect(focused()).toBe("sidebar");
    expect(rowOf("#general")).toBeGreaterThan(-1);
  });
});

describe("message clicks", () => {
  const screenRows = () => app!.screen().split("\n");
  const rowOf = (text: string, fromColumn = 0) =>
    screenRows().findIndex((line) => line.slice(fromColumn).includes(text));
  /** The lines of the selected message that start with its clock (only the focused pane draws the bar). */
  const barred = () => screenRows().filter((line) => /▌ \d\d:\d\d/.test(line));

  test("a click on a message selects it and moves focus to the pane", async () => {
    await start();
    await app!.click(5, 20);
    expect(focused()).toBe("sidebar");

    await app!.click(60, rowOf("plain text"));

    expect(focused()).toBe("messages");
    expect(barred().join()).toContain("plain text");
    expect(barred().join()).not.toContain("parent text");
  });

  test("a click on the author line of a message selects it", async () => {
    await start();
    await app!.click(60, rowOf("plain text") - 1);

    expect(barred().join()).toContain("plain text");
  });

  test("a click on the replies line selects the message and opens its thread", async () => {
    await start();
    await app!.click(60, rowOf("plain text"));
    await app!.click(60, rowOf("↳"));
    await app!.waitForScreen("first reply");

    expect(focused()).toBe("thread");

    await app!.press(keys.escape);
    expect(focused()).toBe("messages");
    expect(barred().join()).toContain("parent text");
  });

  test("a click on a day separator selects nothing but still focuses the pane", async () => {
    await start();
    await app!.click(60, rowOf("plain text"));
    await app!.click(5, 20);
    await app!.click(60, rowOf("──"));

    expect(focused()).toBe("messages");
    expect(barred().join()).toContain("plain text");
  });

  test("a click in the thread pane selects the reply or the parent there", async () => {
    await start();
    await app!.click(60, rowOf("↳"));
    await app!.waitForScreen("first reply");
    await app!.click(60, 10);
    expect(focused()).toBe("messages");

    await app!.click(140, rowOf("parent text", 100));
    expect(focused()).toBe("thread");
    expect(barred().join()).toContain("parent text");

    await app!.click(140, rowOf("first reply", 100));
    expect(barred().join()).toContain("first reply");
  });
});
