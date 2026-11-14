import { render, type RenderOptions } from "ink";
import { App, type AppProps } from "./App";
import {
  createDesktopNotifier,
  describeNotification,
  type DesktopNotifier,
} from "./desktopNotifications";
import {
  createMouseSource,
  mouseReportingOff,
  mouseReportingOn,
} from "./mouse";
import { createNotice } from "./notice";
import { applyTheme, defaultThemeName } from "../theme";
import {
  focusReportingOff,
  focusReportingOn,
  ringBell,
  withoutFocusReports,
} from "./terminalFocus";
import {
  restoreTitle,
  saveTitle,
  setTitle,
  workspaceTitle,
} from "./terminalTitle";

/** Where quit signals come from. Defaults to `process`; tests pass an emitter. */
export type SignalSource = {
  on(signal: "SIGINT" | "SIGTERM", listener: () => void): unknown;
  off(signal: "SIGINT" | "SIGTERM", listener: () => void): unknown;
};

export type RunOptions = Pick<RenderOptions, "stdout" | "stdin"> & {
  signals?: SignalSource;
  /**
   * Whether to ask the terminal for the kitty keyboard protocol, which lets
   * Shift+Enter be told from Enter. Off by default: some terminals and
   * multiplexers mishandle the query, so the config opts in. Alt+Enter and
   * Ctrl+J insert a newline either way.
   */
  kittyKeyboard?: boolean;
  /** The theme to paint with (the config's `theme`). Default: the one already applied. An unknown name means the default, and the status line says so in the status line. */
  themeName?: string;
  /** Whether mentions and DMs ring the terminal bell (the config's `bell`). Default true. */
  bell?: boolean;
  /** Rings the bell. Default: writes the bell character to stdout. */
  ringBell?: () => void;
  /** Whether what rings the bell also shows a desktop notification (the config's `desktopNotifications`). Default false. */
  desktopNotifications?: boolean;
  /** Shows desktop notifications. Default: the platform's own tool (`osascript`, `notify-send`). */
  desktopNotifier?: DesktopNotifier;
};

const quitSignals = ["SIGINT", "SIGTERM"] as const;

/**
 * Takes over the terminal (on its own screen, so the shell's content comes
 * back afterwards) and resolves once the user quits, by `q`, Ctrl+C, or a
 * SIGINT/SIGTERM from outside (closing the tab, `kill`). The session is
 * disconnected, the terminal restored and the remembered conversation saved
 * by then.
 */
export async function runApp(
  props: AppProps,
  {
    signals = process,
    kittyKeyboard = false,
    themeName,
    bell = true,
    ringBell: ring,
    desktopNotifications = false,
    desktopNotifier,
    ...streams
  }: RunOptions = {},
): Promise<void> {
  const stdout = streams.stdout ?? process.stdout;
  const mouse = createMouseSource();
  const stdin = withoutFocusReports(
    streams.stdin ?? process.stdin,
    (focused) => {
      props.session.setTerminalFocused(focused);

      if (!focused) {
        mouse.blur();
      }
    },
    mouse.emit,
  );
  const notice = createNotice();

  if (themeName !== undefined && !applyTheme(themeName)) {
    applyTheme(defaultThemeName);
    notice.set(
      `Unknown theme "${themeName}", using ${defaultThemeName}. See docs/guide.md for the names.`,
    );
  }

  const notifier = desktopNotifications
    ? (desktopNotifier ?? createDesktopNotifier({ onFailure: notice.set }))
    : undefined;

  if (notifier?.unavailable) {
    notice.set(notifier.unavailable);
  }

  const instance = render(<App {...props} notice={notice} mouse={mouse} />, {
    ...streams,
    stdin,
    alternateScreen: true,
    // Ink treats any environment with CI set as non-interactive and draws only
    // the last frame; termslack is interactive whenever it has a terminal.
    interactive: (stdout as { isTTY?: boolean }).isTTY === true,
    exitOnCtrlC: false,
    ...(kittyKeyboard ? { kittyKeyboard: { mode: "auto" as const } } : {}),
  });
  const quit = () => instance.unmount();
  const restoreTerminal = () =>
    void stdout.write(mouseReportingOff + focusReportingOff + restoreTitle);
  const ringTheBell = ring ?? (() => void stdout.write(ringBell));
  const stopListeningForBells = bell
    ? props.session.subscribeToNotifications(ringTheBell)
    : undefined;
  const stopListeningForDesktop =
    notifier && !notifier.unavailable
      ? props.session.subscribeToNotifications((notification) => {
          const { title, body } = describeNotification(
            props.session,
            notification,
          );

          notifier.show(title, body);
        })
      : undefined;

  stdout.write(
    saveTitle +
      setTitle(workspaceTitle(props.workspaceName)) +
      focusReportingOn +
      mouseReportingOn,
  );
  process.once("exit", restoreTerminal);

  for (const signal of quitSignals) {
    signals.on(signal, quit);
  }

  try {
    await instance.waitUntilExit();
  } finally {
    process.off("exit", restoreTerminal);
    restoreTerminal();
    stopListeningForBells?.();
    stopListeningForDesktop?.();

    for (const signal of quitSignals) {
      signals.off(signal, quit);
    }
  }

  await props.session.stop();
  await props.conversationMemory?.flush();
  await props.collapseMemory?.flush();
  await props.hideMutedMemory?.flush();
}
