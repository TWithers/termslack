import { render, type RenderOptions } from "ink";
import { App, type AppProps } from "./App";
import {
  chooseNotifierKind,
  createDesktopNotifier,
  noDesktopNotificationsNotice,
} from "./desktopNotifications";
import {
  createMouseSource,
  mouseReportingOff,
  mouseReportingOn,
} from "./mouse";
import type { NotificationLevel } from "../../config/config";
import { createNotice } from "./notice";
import { createNotificationActions } from "./notificationActions";
import { createTerminalProbe, terminalProbe } from "./terminalAnswers";
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
  /**
   * How mentions and DMs alert (the config's `notifications`): `desktop` shows
   * a desktop notification where the terminal supports one and rings the bell
   * until then and where it doesn't, `bell` only rings, `off` does neither.
   * Without a TTY `desktop` behaves as `bell`. Default `bell`, so a run that
   * isn't asked for notifications sends the terminal no probe; the config
   * reader defaults to `desktop`.
   */
  notifications?: NotificationLevel;
  /** A configured `notifications` value that is no level, named once in the status line. */
  unknownNotifications?: string;
  /** Rings the bell. Default: writes the bell character to stdout. */
  ringBell?: () => void;
  /** The terminal's environment, where `TERM_PROGRAM` names it. Default: `process.env`. */
  env?: Record<string, string | undefined>;
  /** How long to wait for the terminal to answer the startup probe, in ms. Default 1000. */
  probeTimeoutMs?: number;
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
    notifications = "bell",
    unknownNotifications,
    ringBell: ring,
    env = process.env,
    probeTimeoutMs = 1000,
    ...streams
  }: RunOptions = {},
): Promise<void> {
  const stdout = streams.stdout ?? process.stdout;
  const mouse = createMouseSource();
  const notificationActions = createNotificationActions();
  let notifier: ReturnType<typeof createDesktopNotifier>;
  let probe: ReturnType<typeof createTerminalProbe> | undefined;
  const stdin = withoutFocusReports(
    streams.stdin ?? process.stdin,
    (focused) => {
      props.session.setTerminalFocused(focused);

      if (focused) {
        notificationActions.windowFocused();
      }

      if (!focused) {
        mouse.blur();
      }
    },
    mouse.emit,
    (answer) => {
      if (answer.kind !== "notificationClick") {
        probe?.answer(answer);

        return;
      }

      const target = notifier?.activate(answer.identifier);

      if (target) {
        notificationActions.activate(target);
      }
    },
    () => probe?.running === true,
  );
  const notice = createNotice();

  if (themeName !== undefined && !applyTheme(themeName)) {
    applyTheme(defaultThemeName);
    notice.set(
      `Unknown theme "${themeName}", using ${defaultThemeName}. See docs/guide.md for the names.`,
    );
  }

  if (unknownNotifications !== undefined) {
    notice.set(
      `Unknown notifications "${unknownNotifications}", using desktop. Use "desktop", "bell" or "off".`,
    );
  }

  const ringTheBell = ring ?? (() => void stdout.write(ringBell));
  const desktopWanted =
    notifications === "desktop" &&
    (stdout as { isTTY?: boolean }).isTTY === true;

  if (desktopWanted) {
    probe = createTerminalProbe(probeTimeoutMs, ({ name, osc99 }) => {
      notifier = createDesktopNotifier(
        chooseNotifierKind({ name, osc99, termProgram: env.TERM_PROGRAM }),
        props.session,
        (bytes) => void stdout.write(bytes),
      );

      if (!notifier) {
        notice.set(noDesktopNotificationsNotice);

        return;
      }

      notificationActions.useDismisser(notifier.dismiss);
    });
  }

  const instance = render(
    <App
      {...props}
      notice={notice}
      mouse={mouse}
      notificationActions={notificationActions}
    />,
    {
      ...streams,
      stdin,
      alternateScreen: true,
      // Ink treats any environment with CI set as non-interactive and draws only
      // the last frame; termslack is interactive whenever it has a terminal.
      interactive: (stdout as { isTTY?: boolean }).isTTY === true,
      exitOnCtrlC: false,
      ...(kittyKeyboard ? { kittyKeyboard: { mode: "auto" as const } } : {}),
    },
  );
  const quit = () => instance.unmount();
  const restoreTerminal = () => {
    notifier?.closeAll();
    stdout.write(mouseReportingOff + focusReportingOff + restoreTitle);
  };
  const stopListeningForAlerts =
    notifications !== "off"
      ? props.session.subscribeToNotifications((notification) =>
          notifier ? notifier.show(notification) : ringTheBell(),
        )
      : undefined;

  stdout.write(
    saveTitle +
      setTitle(workspaceTitle(props.workspaceName)) +
      focusReportingOn +
      mouseReportingOn +
      (desktopWanted ? terminalProbe : ""),
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
    probe?.stop();
    stopListeningForAlerts?.();

    for (const signal of quitSignals) {
      signals.off(signal, quit);
    }
  }

  await props.session.stop();
  await props.conversationMemory?.flush();
  await props.collapseMemory?.flush();
  await props.hideMutedMemory?.flush();
}
