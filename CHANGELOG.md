# Changelog

## 0.2.0 - 2026-11-16

### Added

- Links in messages, search results and channel details are terminal hyperlinks (OSC 8): click a label, or the address after it, to open it in terminals that support them. Only `http`, `https` and `mailto` addresses are linked.

### Changed

- The sidebar, panes and popups are rounded boxes with their titles on the border; the focused one is drawn in the focus colour. Each pane's input sits inside it under a divider.
- The status bar is gone: the message pane's bottom border is now the status line (a question, else notices, else the keys for what has focus), and the connection moves to the sidebar's bottom border. Popups show their keys on their bottom border.
- Keys in the key hints are drawn in the theme's focus colour so they stand out from what they do.
- README is now short; details moved to docs/guide.md and CONTRIBUTING.md.

### Fixed

- Emoji-styled symbols (❤️, ⚠️) are drawn as their plain one-cell symbol and keycaps (1️⃣) as their character, so rows line up in every terminal.
- On macOS, startup no longer shows the Keychain password prompt many times: each workspace's credentials are read once per run and written only when they change.

## 0.1.0 - 2026-11-13

First release.

- A full-screen terminal client for one Slack workspace: channels, private channels, DMs and group DMs, read and written from the keyboard, with mouse support (click to focus, select, scroll, hover).
- Each user creates their own private Slack app from a manifest during setup and connects over Socket Mode, so there is no server to run. Tokens are kept in the OS keychain.
- Messages with Slack formatting, emoji, attachments, Block Kit content, reactions and reply counts; scroll back through history; threads in their own pane with replies.
- Write, reply, edit, delete and react; `@person`, `#channel` and emoji completion.
- Unread and mention markers from Slack's own read state, DMs sorted by recent activity, collapsible sidebar sections, and a channel menu (details, mute, leave, move to a section).
- Quick switcher (`Ctrl+K`) to jump to, start or join conversations, and message search (`/`).
- Terminal bell and optional desktop notifications for mentions and DMs, respecting Do Not Disturb and terminal focus; presence for the DMs on screen.
- Its own theme (Slack-dark by default) plus the Omarchy themes, switchable while running (`T`).
- `termslack --help`, `--version`, and `--log`, `--raw` and `--history` for a plain event log.
