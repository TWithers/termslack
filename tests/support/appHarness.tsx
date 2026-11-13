import { render } from "ink-testing-library";
import type { SectionConfig } from "../../src/config/config";
import type {
  CollapseMemory,
  HideMutedMemory,
  SectionsMemory,
  ConversationMemory,
} from "../../src/config/state";
import { App } from "../../src/ui/app/App";
import {
  createMouseReportFilter,
  createMouseSource,
} from "../../src/ui/app/mouse";
import { loadFixture } from "./fixtures";
import { type FakeSlack, waitFor } from "./fakeSlack";
import { type SessionHarness, startSessionHarness } from "./sessionHarness";

/** What a terminal sends for the keys the app cares about. */
export const keys = {
  up: "\x1b[A",
  down: "\x1b[B",
  left: "\x1b[D",
  right: "\x1b[C",
  enter: "\r",
  tab: "\t",
  pageUp: "\x1b[5~",
  pageDown: "\x1b[6~",
  escape: "\x1b",
  ctrlC: "\x03",
  ctrlK: "\x0b",
  ctrlN: "\x0e",
  ctrlP: "\x10",
  backspace: "\x7f",
} as const;

/** A mouse report as the terminal writes it (SGR): `code` is the button and modifier bits; column and row count from 0. */
export function sgrMouse(
  code: number,
  column: number,
  row: number,
  final: "M" | "m",
): string {
  return `\x1b[<${code};${column + 1};${row + 1}${final}`;
}

export type AppHarness = SessionHarness & {
  /** The rendered screen right now, without colors. */
  screen(): string;
  /** The rendered screen right now with its colour escape codes, one string per row. */
  coloredScreen(): string[];
  /** Every screen drawn so far, without colors, oldest first. */
  frames(): string[];
  /** Every screen drawn so far with its colour escape codes, oldest first. */
  coloredFrames(): string[];
  /** Resolves with the screen once it contains `text`, or fails after the timeout. */
  waitForScreen(text: string | RegExp, timeoutMs?: number): Promise<string>;
  /** Types keys (raw terminal input, see `keys`) and lets the app react. */
  press(input: string): Promise<void>;
  /** Sends a mouse report as the terminal would write it: a left click at `column`, `row` (from 0) is a press then a release. */
  click(column: number, row: number): Promise<void>;
  /** Rolls the wheel `times` steps over `column`, `row`, all in one read as a trackpad's burst arrives. */
  wheel(
    direction: "up" | "down",
    column: number,
    row: number,
    times?: number,
  ): Promise<void>;
  /** Moves the pointer to `column`, `row` with no button down, as the terminal reports it. */
  hover(column: number, row: number): Promise<void>;
  /** Sends the raw text of a mouse report (see `sgrMouse`). */
  mouse(report: string): Promise<void>;
  /** The terminal window loses focus (its focus report, as `withoutFocusReports` hands it on). */
  loseTerminalFocus(): Promise<void>;
  /** Changes the terminal size and tells the app, like a window resize does. */
  resize(columns: number, rows: number): Promise<void>;
};

/**
 * Fake Slack with a small workspace: two channels, two DMs and a group DM,
 * and the people they involve.
 */
export async function seedWorkspace(slack: FakeSlack): Promise<void> {
  const [channels] = await loadFixture("users-conversations-channels");
  const [directs] = await loadFixture("users-conversations-dms");
  const people = await loadFixture("users-list");
  const [members] = await loadFixture("conversations-members-mpim");

  slack.respondPaged("users.conversations", [channels!, directs!]);
  slack.respondPaged("users.list", people);
  slack.respond("conversations.members", () => members!);
}

/**
 * Renders the whole app with `ink-testing-library` on a session connected to
 * fake Slack, with a terminal of the given size.
 */
export async function startAppHarness(
  options: Parameters<typeof startSessionHarness>[0] & {
    columns?: number;
    rows?: number;
    /** Whether fake Slack starts with the small workspace from `seedWorkspace`. Default true. */
    seed?: boolean;
    workspaceName?: string;
    /** The app's clock, for day labels like "Today". Default the real time. */
    now?: () => Date;
    /** Where the app remembers the open conversation. Default: nothing is remembered. */
    conversationMemory?: ConversationMemory;
    /** How many recent DMs the sidebar lists (the config's `recentDms`). Default: the app's own. */
    recentDms?: number;
    /** The sidebar sections `config.toml` names (the session's `configuredSections`). Default: none. */
    sections?: SectionConfig[];
    /** Where the sections termslack keeps are remembered. Default: nothing is remembered. */
    sectionsMemory?: SectionsMemory;
    /** Where the app remembers collapsed sections. Default: nothing is remembered. */
    collapseMemory?: CollapseMemory;
    /** Where the app remembers whether muted channels are hidden. Default: nothing is remembered. */
    hideMutedMemory?: HideMutedMemory;
    /** Saves the theme chosen in the theme picker. Default: it is only kept. */
    saveTheme?: (name: string) => Promise<void>;
  } = {},
): Promise<AppHarness> {
  const {
    columns = 100,
    rows = 30,
    seed = true,
    workspaceName = "Acme",
  } = options;
  const session = await startSessionHarness({
    ...options,
    configuredSections: options.sections,
    prepare: async (slack) => {
      if (seed) {
        await seedWorkspace(slack);
      }

      await options.prepare?.(slack);
    },
  });

  const mouse = createMouseSource();
  const filterMouse = createMouseReportFilter(mouse.emit);
  const view = render(
    <App
      mouse={mouse}
      session={session.session}
      workspaceName={workspaceName}
      now={options.now}
      conversationMemory={options.conversationMemory}
      recentDms={options.recentDms}
      collapseMemory={options.collapseMemory}
      hideMutedMemory={options.hideMutedMemory}
      saveTheme={options.saveTheme}
    />,
  );
  let size = { columns, rows };

  Object.defineProperty(view.stdout, "columns", { get: () => size.columns });
  Object.defineProperty(view.stdout, "rows", { get: () => size.rows });
  view.stdout.emit("resize");

  const screen = () => Bun.stripANSI(view.lastFrame() ?? "");

  /**
   * Waits until the app has stopped drawing for a moment, so a slow frame is
   * not missed; gives up after a second if it never stops.
   */
  async function settle() {
    const deadline = Date.now() + 1000;

    for (
      let drawn = -1;
      drawn !== view.frames.length && Date.now() < deadline;
    ) {
      drawn = view.frames.length;
      await Bun.sleep(25);
    }
  }

  return {
    ...session,
    screen,
    coloredScreen: () => (view.lastFrame() ?? "").split("\n"),
    frames: () => view.frames.map((frame) => Bun.stripANSI(frame)),
    coloredFrames: () => [...view.frames],
    waitForScreen: (text, timeoutMs) =>
      waitFor(
        () =>
          (typeof text === "string"
            ? screen().includes(text)
            : text.test(screen())) && screen(),
        timeoutMs,
      ),
    async press(input) {
      view.stdin.write(input);
      await settle();
    },
    async mouse(report) {
      filterMouse(report);
      await settle();
    },
    async hover(column, row) {
      filterMouse(sgrMouse(35, column, row, "M"));
      await settle();
    },
    async loseTerminalFocus() {
      mouse.blur();
      await settle();
    },
    async wheel(direction, column, row, times = 1) {
      filterMouse(
        sgrMouse(direction === "up" ? 64 : 65, column, row, "M").repeat(times),
      );
      await settle();
    },
    async click(column, row) {
      filterMouse(sgrMouse(0, column, row, "M"));
      filterMouse(sgrMouse(0, column, row, "m"));
      await settle();
    },
    async resize(nextColumns, nextRows) {
      size = { columns: nextColumns, rows: nextRows };
      view.stdout.emit("resize");
      await settle();
    },
    async stop() {
      view.unmount();
      await session.stop();
    },
  };
}
