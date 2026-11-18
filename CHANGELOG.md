# Changelog

## 0.3.0 - 2026-11-18

### Added

- Each channel can notify for mentions only (the default), every message, or nothing, chosen from the channel menu (`m` then `n`) and remembered per workspace.
- Desktop notifications come from the terminal itself: termslack asks the terminal what it supports at startup and uses kitty's OSC 99 (and Solo's), Ghostty's OSC 777 or iTerm2's OSC 9. They follow the terminal's own notification settings.
- In kitty, clicking a notification brings the terminal forward and opens the conversation (and the thread, for a thread reply); each conversation keeps one notification, replaced by newer messages; DMs are critical; a notification closes once you open its conversation, and any still shown close when termslack quits.

### Changed

- One `notifications` setting replaces `bell` and `desktopNotifications`: `"desktop"` (the default), `"bell"` or `"off"`. With `"desktop"` the bell rings only where the terminal can't show a notification. Old `bell = false` and `desktopNotifications = false` settings still work.
- Desktop notifications are on by default.
- Notifications come at most every 5 seconds instead of once a minute.

### Removed

- Desktop notifications through `osascript` and `notify-send`.

## 0.2.1 - 2026-11-17

### Fixed

- The reconnect tests no longer fail intermittently: they gave the Slack SDK only 50 ms to see a pong, so a slow frame made it drop a healthy connection and lose the events sent to it. No change to termslack itself.

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
