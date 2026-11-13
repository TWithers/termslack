import { afterEach, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { waitFor } from "./support/fakeSlack";
import { seedWorkspace } from "./support/appHarness";
import { fakeTerminal } from "./support/fakeTerminal";
import {
  type SessionHarness,
  startSessionHarness,
} from "./support/sessionHarness";
import { runApp } from "../src/ui/app/run";
import { restoreTitle, saveTitle } from "../src/ui/app/terminalTitle";

let harness: SessionHarness;

afterEach(() => harness.stop());

const leaveAlternateScreen = "\x1b[?1049l";

async function startRunning({
  kittyKeyboard,
}: { kittyKeyboard?: boolean } = {}) {
  harness = await startSessionHarness({ prepare: seedWorkspace });

  const terminal = fakeTerminal();
  const signals = new EventEmitter();
  const finished = runApp(
    { session: harness.session, workspaceName: "Acme" },
    {
      signals,
      kittyKeyboard,
      stdout: terminal.stdout,
      stdin: terminal.stdin as unknown as NodeJS.ReadStream,
    },
  );

  await waitFor(() => terminal.written().includes("Acme · "));
  await waitFor(() => harness.session.listingHealth().people === "loaded");
  await waitFor(
    () => harness.session.listingHealth().conversations === "loaded",
  );
  await Bun.sleep(50);

  return { terminal, signals, finished };
}

test.each(["SIGINT", "SIGTERM"])(
  "%s disconnects the session and restores the terminal, like q",
  async (signal) => {
    const { terminal, signals, finished } = await startRunning();

    expect(terminal.rawModes.at(-1)).toBe(true);
    expect(terminal.written()).not.toContain(leaveAlternateScreen);

    signals.emit(signal);
    await finished;

    expect(harness.session.status).toBe("disconnected");
    expect(terminal.rawModes.at(-1)).toBe(false);
    expect(terminal.written()).toContain(leaveAlternateScreen);
  },
);

test("quitting stops listening for signals", async () => {
  const { signals, finished } = await startRunning();

  expect(signals.listenerCount("SIGINT")).toBe(1);
  expect(signals.listenerCount("SIGTERM")).toBe(1);

  signals.emit("SIGTERM");
  await finished;

  expect(signals.listenerCount("SIGINT")).toBe(0);
  expect(signals.listenerCount("SIGTERM")).toBe(0);
});

test("q still quits the same way", async () => {
  const { terminal, signals, finished } = await startRunning();

  terminal.stdin.write("q");
  await finished;

  expect(harness.session.status).toBe("disconnected");
  expect(terminal.written()).toContain(leaveAlternateScreen);
  expect(signals.listenerCount("SIGINT")).toBe(0);
});

const kittyQuery = "\x1b[?u";

test("the kitty keyboard protocol is not asked for unless the config enables it", async () => {
  const { terminal, signals, finished } = await startRunning();

  expect(terminal.written()).not.toContain(kittyQuery);

  signals.emit("SIGTERM");
  await finished;
});

test("the kitty keyboard protocol is asked for when the config enables it", async () => {
  const { terminal, signals, finished } = await startRunning({
    kittyKeyboard: true,
  });

  expect(terminal.written()).toContain(kittyQuery);

  signals.emit("SIGTERM");
  await finished;
});

test.each(["q", "SIGINT", "SIGTERM"])(
  "termslack names the tab after the workspace and gives the old title back when leaving by %s",
  async (leave) => {
    const { terminal, signals, finished } = await startRunning();
    const named = "\x1b]0;Acme - Slack\x1b\\";

    expect(terminal.written()).toContain(named);
    expect(terminal.written().indexOf(saveTitle)).toBeLessThan(
      terminal.written().indexOf(named),
    );
    expect(terminal.written()).not.toContain(restoreTitle);

    if (leave === "q") {
      terminal.stdin.write("q");
    } else {
      signals.emit(leave);
    }

    await finished;

    expect(terminal.written().lastIndexOf(restoreTitle)).toBeGreaterThan(
      terminal.written().lastIndexOf(named),
    );
  },
);
