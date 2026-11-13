# termslack

A terminal client for Slack. You create your own private Slack app during setup and connect over Socket Mode, so there is no server to run.

<!-- TODO: add a screenshot of termslack here, e.g. docs/screenshot.png -->

## Install

Homebrew (macOS and Linux):

```bash
brew install twithers/tap/termslack
```

Or download the archive for your platform from [GitHub Releases](https://github.com/TWithers/termslack/releases), check it against `checksums.txt`, and put the `termslack` binary on your `PATH`:

```bash
shasum -a 256 -c checksums.txt --ignore-missing   # macOS
sha256sum -c checksums.txt --ignore-missing       # Linux
tar -xzf termslack-<version>-<os>-<arch>.tar.gz
sudo mv termslack /usr/local/bin/
```

On macOS the binaries are unsigned. Allow a browser download in System Settings, Privacy & Security, or install with Homebrew. When macOS asks for Keychain access, choose "Always Allow" (it asks again after an upgrade).

## Setup

- Run `termslack`. It walks you through creating your Slack app.
- You need a configuration token from <https://api.slack.com/apps> and a workspace that lets members create apps.
- It opens a browser for you to approve the app.

## Using it

| Key               | Does                                    |
| ----------------- | --------------------------------------- |
| `Tab`             | Move to the next pane                   |
| `j` `k` / `↑` `↓` | Move the selection                      |
| `Enter`           | Open a conversation or a thread         |
| `Ctrl+K`          | Quick switcher: jump to a channel or DM |
| `/`               | Search messages                         |
| `i`               | Write a message (`Esc` leaves the box)  |
| `t`               | Open a message's thread                 |
| `r`               | React to a message                      |
| `e` / `d`         | Edit / delete your message              |
| `m`               | Channel menu (mute, details, move)      |
| `M`               | Hide or show muted channels             |
| `T`               | Change theme                            |
| `?`               | Help                                    |
| `q` / `Ctrl+C`    | Quit                                    |

Press `?` for every key. The mouse works too: click to focus, select and open.

## Configuration

Optional. Top-level settings go at the top of `~/.config/termslack/config.toml`, before any `[workspaces...]` table:

```toml
theme = "nord"                # default: slack-dark
bell = true                   # ring the terminal bell for mentions and DMs
desktopNotifications = false  # also show a desktop notification
kittyKeyboard = false         # lets Shift+Enter insert a newline

[workspaces.T0123ABCD]
recentDms = 10                # how many recent DMs the sidebar lists
```

Sections, mutes and other things termslack remembers live in the state file.

## Where things live

| What                      | Where                                                    |
| ------------------------- | -------------------------------------------------------- |
| Config (you edit)         | `~/.config/termslack/config.toml` (`XDG_CONFIG_HOME`)    |
| State (termslack writes)  | `~/.local/state/termslack/state.toml` (`XDG_STATE_HOME`) |
| Tokens                    | OS keychain, service `termslack`                         |
| Fallback without keychain | `~/.config/termslack/credentials.toml` (mode 0600)       |

## More

How everything behaves, in detail: [docs/guide.md](docs/guide.md). Building and releasing: [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT, see [LICENSE](LICENSE).
