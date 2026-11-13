import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import chalk from "chalk";
import { EventEmitter } from "node:events";
import { runApp } from "../src/ui/app/run";
import { applyTheme, defaultThemeName, theme } from "../src/ui/theme";
import {
  type AppHarness,
  seedWorkspace,
  startAppHarness,
} from "./support/appHarness";
import { waitFor } from "./support/fakeSlack";
import { fakeTerminal } from "./support/fakeTerminal";
import {
  type SessionHarness,
  startSessionHarness,
} from "./support/sessionHarness";

let colourLevel: typeof chalk.level;
let app: AppHarness | undefined;
let harness: SessionHarness | undefined;
let quit: (() => Promise<void>) | undefined;

/** Ink only emits colour codes when it thinks the terminal has colour. */
beforeAll(() => {
  colourLevel = chalk.level;
  chalk.level = 3;
});

afterAll(() => {
  chalk.level = colourLevel;
});

afterEach(async () => {
  await quit?.();
  quit = undefined;
  await app?.stop();
  await harness?.stop();
  app = undefined;
  harness = undefined;
  applyTheme(defaultThemeName);
});

/** The escape that sets a 24-bit background, as Ink writes it. */
function backgroundCode(colour: string): string {
  const [red, green, blue] = [1, 3, 5].map((at) =>
    Number.parseInt(colour.slice(at, at + 2), 16),
  );

  return `\u001b[48;2;${red};${green};${blue}m`;
}

const rowWith = (text: string) =>
  app!.coloredScreen().find((row) => Bun.stripANSI(row).includes(text))!;

test.each(["nord", "catppuccin-latte"])(
  "starting with the %s theme paints the first frame with its colours",
  async (name) => {
    applyTheme(name);
    app = await startAppHarness({ columns: 100, rows: 30 });
    await app.waitForScreen("#general", 5000);

    expect(rowWith("#random")).toContain(
      backgroundCode(theme.sidebarBackground),
    );
    expect(rowWith("Acme")).toContain(
      backgroundCode(theme.statusBarBackground),
    );
    expect(app.coloredScreen().join("\n")).toContain(
      backgroundCode(theme.paneBackground),
    );
  },
);

async function startRunning(themeName?: string) {
  harness = await startSessionHarness({ prepare: seedWorkspace });

  const terminal = fakeTerminal();
  const signals = new EventEmitter();
  const finished = runApp(
    { session: harness.session, workspaceName: "Acme" },
    {
      themeName,
      signals,
      stdout: terminal.stdout,
      stdin: terminal.stdin as unknown as NodeJS.ReadStream,
    },
  );

  quit = async () => {
    signals.emit("SIGINT");
    await finished;
  };

  await waitFor(() => terminal.written().includes("Acme · "));

  return { terminal };
}

test("runApp paints with the configured theme", async () => {
  const { terminal } = await startRunning("nord");

  expect(theme.paneBackground).not.toBe("#1a1d21");
  expect(terminal.written()).toContain(backgroundCode(theme.paneBackground));
});

test("an unknown theme name falls back to the default and the status bar names it", async () => {
  const { terminal } = await startRunning("not-a-theme");

  await waitFor(() =>
    terminal.written().includes('Unknown theme "not-a-theme"'),
  );

  expect(theme.paneBackground).toBe("#1a1d21");
});
