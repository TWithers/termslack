import { version } from "./version";

export type Options = {
  /** `--raw`: print each event's payload as Slack sent it. */
  raw: boolean;
  /** `--log`: print the event log instead of opening the UI. */
  log: boolean;
  /** `--history <channel>`: the conversation to print recent history of. */
  history?: string;
};

export type CliAction =
  | { action: "version" }
  | { action: "help" }
  | { action: "error"; message: string }
  | { action: "run"; options: Options };

export const versionText = `termslack ${version}`;

export const helpText = `termslack ${version}: a terminal Slack client.

Usage:
  termslack [options]

Run it with no options to open the full-screen UI. The first run walks you
through setting up a Slack app and signing in.

Options:
  -h, --help             Show this help and exit.
  -v, --version          Show the version and exit.
  --log                  Print the plain event log instead of opening the UI.
  --raw                  With the event log: print raw event JSON (implies --log).
  --history <channel>    Print recent messages of a channel (name, @person or ID)
                         before the event log (implies --log).
                         Also accepted as --history=<channel>.

Files:
  Config   ~/.config/termslack/config.toml    (respects XDG_CONFIG_HOME)
  State    ~/.local/state/termslack/state.toml (respects XDG_STATE_HOME)
  Secrets  the system keychain, or ~/.config/termslack/credentials.toml

More: https://github.com/TWithers/termslack`;

/**
 * Decides what a command line asks for: the version, the help, an error for
 * an option termslack doesn't know, or a normal run.
 */
export function parseArgs(args: string[]): CliAction {
  if (args.includes("--help") || args.includes("-h")) {
    return { action: "help" };
  }

  if (args.includes("--version") || args.includes("-v")) {
    return { action: "version" };
  }

  let history: string | undefined;
  let raw = false;
  let log = false;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;

    if (arg === "--raw") {
      raw = true;
    } else if (arg === "--log") {
      log = true;
    } else if (arg.startsWith("--history=")) {
      history = arg.slice("--history=".length);
    } else if (arg === "--history") {
      history = args[index + 1] ?? "";
      index++;
    } else {
      return {
        action: "error",
        message: arg.startsWith("-")
          ? `Unknown option: ${arg}`
          : `Unexpected argument: ${arg}`,
      };
    }

    if (history !== undefined && (history === "" || history.startsWith("--"))) {
      return {
        action: "error",
        message: "--history needs a channel: a name, @person or an ID.",
      };
    }
  }

  return {
    action: "run",
    options: { raw, log: log || raw || history !== undefined, history },
  };
}
