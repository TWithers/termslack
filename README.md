# termslack

A terminal Slack client. Each user gets their own private Slack app (created from a manifest during setup) and connects over Socket Mode, so there's no server to run.

<!-- TODO: add a screenshot of termslack here, e.g. docs/screenshot.png -->

## Install

### Homebrew (macOS and Linux)

```bash
brew install twithers/tap/termslack
```

Homebrew also avoids the macOS download warning described below.

### GitHub Releases

Each [release](https://github.com/TWithers/termslack/releases) has one archive per platform, named `termslack-<version>-<os>-<arch>.tar.gz`:

| Platform             | Archive                               |
| -------------------- | ------------------------------------- |
| macOS, Apple Silicon | `termslack-0.1.0-darwin-arm64.tar.gz` |
| macOS, Intel         | `termslack-0.1.0-darwin-x64.tar.gz`   |
| Linux, x64           | `termslack-0.1.0-linux-x64.tar.gz`    |
| Linux, arm64         | `termslack-0.1.0-linux-arm64.tar.gz`  |

Download the archive for your platform and the release's checksums file (`checksums.txt`, the SHA-256 of every archive), then check it before unpacking:

```bash
shasum -a 256 -c checksums.txt --ignore-missing   # macOS
sha256sum -c checksums.txt --ignore-missing       # Linux
```

Unpack it and put the `termslack` binary somewhere on your `PATH`:

```bash
tar -xzf termslack-0.1.0-darwin-arm64.tar.gz
sudo mv termslack /usr/local/bin/        # or ~/.local/bin, if that is on your PATH
termslack --version
```

### macOS notes

The binaries are not signed or notarised. A binary downloaded in a browser is quarantined by macOS and refused at first; allow it under System Settings, Privacy & Security (scroll down to the message about `termslack` and choose "Allow Anyway"), or remove the quarantine flag yourself with `xattr -d com.apple.quarantine termslack`. Installing with Homebrew (or downloading with `curl`) doesn't set the flag.

termslack keeps your Slack tokens in the macOS Keychain. After an upgrade the binary is a new, differently signed program, so macOS may ask again whether it may use those Keychain entries; choose "Always Allow".

### Build from source

You need [Bun](https://bun.com).

```bash
git clone https://github.com/TWithers/termslack.git
cd termslack
bun install
bun run build        # single binary for this machine → dist/termslack
```

`bun run build:release` cross-compiles all four platforms and writes the archives (`termslack-<version>-<os>-<arch>.tar.gz`, each holding one `termslack` binary) and `checksums.txt` to `dist/release/`. Linux binaries are built for glibc.

See [Develop](#develop) for the other commands.

## Setup

termslack doesn't share a Slack app: each user creates their own private one, and the first run walks you through it. You need:

- A Slack workspace that lets members create apps (some workspaces restrict this to admins; ask an admin if setup is refused).
- A configuration token from <https://api.slack.com/apps> (under "Your App Configuration Tokens", generate a token and copy the **Refresh Token**, which starts with `xoxe-`). termslack uses it once to create the app from a manifest, and keeps it to update the app after upgrades.
- An app-level token with the `connections:write` scope, which setup sends you to generate in the new app's settings.

Setup then opens a browser to authorize the app as you. The app asks for user-token scopes only (it acts as you, not as a bot): reading and writing messages, reactions, channels, DMs, search, presence and Do Not Disturb state. The tokens are stored in your OS keychain, or in `~/.config/termslack/credentials.toml` when there is none. The full list is in `src/setup/manifest.ts`.

## Run

From a source checkout (an installed binary just runs as `termslack`, with the same options):

```bash
bun install
bun start            # or: bun src/index.ts
bun start --log      # plain event log instead of the UI
bun start --raw      # with the event log: raw event JSON instead of formatted lines
bun start --history general   # event log, printing recent messages first
bun start --version  # print the version (also -v) and exit
bun start --help     # print usage (also -h) and exit
```

An option termslack doesn't know prints an error pointing to `--help` and exits non-zero instead of starting. The version comes from `package.json`, which `bun build --compile` bundles, so a built binary and `bun src/index.ts` print the same `termslack 0.1.0`.

`termslack` opens a full-screen terminal UI: conversations on the left (channels sorted by name, then DMs and group DMs, most recently active first) and a status bar with the workspace, your name and the connection state. The terminal's window and tab title becomes the workspace's name, as the Slack app names its windows (`The HQ - Slack`). Press `q` or Ctrl+C to quit; the terminal is restored as it was, including its previous title in terminals that keep a title stack (xterm, kitty, WezTerm, Ghostty, iTerm2). In tmux the title reaches the outer terminal only with `set -g set-titles on` and `set -g set-titles-string '#T'`. The conversation you had open is reopened on the next start. `--log` shows the plain event log instead, and `--raw` and `--history` imply it.

termslack paints the whole screen with its own theme (by default a dark one in the style of Slack's dark mode) instead of your terminal's background and text colours, so it looks the same in every terminal. Terminals limited to 256 colours get the nearest match.

To choose another theme, add a top-level `theme` to `~/.config/termslack/config.toml` (before any `[workspaces...]` table); it is read at startup:

```toml
theme = "nord"
```

The names are `slack-dark` (the default) and [Omarchy](https://github.com/basecamp/omarchy)'s themes (MIT, copyright David Heinemeier Hansson; their palettes are in `src/ui/omarchyPalettes.ts` with its licence): `catppuccin`, `catppuccin-latte`, `ethereal`, `everforest`, `flexoki-light`, `gruvbox`, `hackerman`, `jade-horse`, `kanagawa`, `last-horizon`, `lumon`, `lupine`, `matte-black`, `miasma`, `nord`, `retro-82`, `ristretto`, `rose-pine`, `solitude`, `starship`, `tokyo-night`, `vantablack` and `white`. An unknown name starts termslack with `slack-dark` and says so in the status bar.

Press `T` (Shift+T) to switch themes while termslack runs: the arrows move the highlighted row and repaint the whole screen in that theme, typing filters the list, `Enter` keeps the theme and saves it as `theme` in `config.toml`, and `Esc` puts back the one you had.

DMs are ordered by when they last had a message, which Slack's listings don't say. On first run termslack starts from each DM's `updated` time and, in the background, asks for every DM's newest message about one a second (a couple of minutes for ~120 DMs), re-sorting as answers arrive; DMs whose history Slack refuses (deactivated users) are hidden. The results are kept in the state file, so later starts sort at once, and termslack uses `search.messages` (the `search:read` scope) to catch up on DMs that had messages while it was closed. With tokens from the environment nothing is remembered and the pass runs every start.

Shift+Enter inserts a newline only in terminals that speak the kitty keyboard protocol, and termslack doesn't ask for it by default because some terminals and multiplexers mishandle the request. Alt+Enter and Ctrl+J insert a newline everywhere. To turn the protocol on, add a top-level setting to `~/.config/termslack/config.toml` (before any `[workspaces...]` table):

```toml
kittyKeyboard = true
```

The DM section lists only the 10 most recently active DMs and group DMs, plus any with unread messages or mentions and the open conversation, wherever they rank. Its heading says how many are shown: `Direct messages · 10 of 118`. With the sidebar focused, press `a` to list all DMs (`Direct messages · all 118`) and `a` again to go back to recent; the mode is not remembered between runs. Change the number in the workspace's section of `~/.config/termslack/config.toml` (a positive whole number; anything else means 10):

```toml
[workspaces.T0123ABCD]
recentDms = 25
```

### Unread and mention markers

Conversations show as unread (bold, bright) and with a red mention count as messages arrive while termslack runs. When you open a conversation the markers clear.

termslack also finds what was already unread in Slack before it started. Once the conversation list has loaded and the DM activity pass above has finished, it works through your conversations in the background, one Slack call about every 1.3 seconds: recent DMs first, then channels, then older DMs. For each it reads your `last_read` time (`conversations.info`) and compares it with the newest message (a DM's is usually already known from the DM pass; otherwise `conversations.history`). Conversations whose newest message is newer and isn't yours are marked; unread DMs and group DMs count as one mention, channels show unread only (termslack doesn't scan their history for mentions). With ~135 conversations expect around three to five minutes in all; the sidebar updates as results arrive and nothing waits for it. A conversation you open before its check finishes is never marked by it, and messages arriving live mark as usual. The check is skipped with `--log`.

Opening a conversation also marks it read in Slack (`conversations.mark`) once its history has loaded, up to the newest message that loaded, so other devices stop showing it unread; new messages arriving in the open conversation are marked too. Until the history has loaded nothing is marked and the sidebar keeps the conversation's unread marker, so a slow or failed load, or switching away first, never clears messages you haven't seen. Requests are batched (about 0.75 seconds), and failures are ignored: local clearing always works, and if Slack says the token can't mark conversations (for example a missing scope) termslack stops trying for the rest of the session.

### Notifications

termslack rings the terminal bell when a message arrives live that would get a mention marker: it mentions you, a user group you're in, or `@here`/`@channel`/`@everyone`, or it is in a DM or group DM (including thread replies that mention you). Your own messages, edits, deletes, history loads and the startup unread check never ring. While the terminal window has the focus nothing rings, in any conversation: the sidebar's markers are enough while you're looking at termslack (a terminal that never reports focus is treated as unfocused, so it rings). Several messages within about a second ring once, and never more than about once a minute: what arrives within the minute after a ring is held and rings together when the minute is up. Focusing the terminal, or Do Not Disturb starting, drops what is held. termslack doesn't know which conversations you've muted in Slack, so those aren't left out; channels you mute in termslack (see Muting a channel) never ring.

To turn the bell off, add a top-level setting to `~/.config/termslack/config.toml` (before any `[workspaces...]` table); it is on by default:

```toml
bell = false
```

Nothing rings while Slack's Do Not Disturb is on. termslack reads `dnd.info` at startup (the `dnd:read` scope) and follows `dnd_updated` events, for both snooze and scheduled hours, and a scheduled window starts and ends by itself while termslack runs. If `dnd.info` fails or the permission is missing, termslack rings normally and says so in the status bar.

termslack asks the terminal to report when its window gains or loses focus (`CSI ? 1004 h`, turned off again however termslack exits). While the terminal is known to be focused, messages in the conversation you have open (or the thread you have open) don't ring, as long as you can see them: the conversation's messages count only while the message pane is on screen (a thread replaces it in a narrow terminal) and the help or the search isn't covering it, and the thread's replies only while the help and the search aren't covering the thread pane. The quick switcher's small popup doesn't count as covering. Terminals that don't report focus are treated as unfocused, so everything rings.

#### Desktop notifications

Optionally, whatever rings the bell also shows a desktop notification, so you see who wrote what from another window. It is off by default; turn it on with a top-level setting in `~/.config/termslack/config.toml`:

```toml
desktopNotifications = true
```

It is the same message as the bell, so the same rules apply (Do Not Disturb, the terminal being focused, several messages within about a second making one, at most one a minute). The title is the conversation and the author (`#random · Ana`; just the person for a DM), the body is the message as plain text, cut to 200 characters. A burst shows one notification, "3 new messages in #random" (or just "3 new messages" across conversations), with the newest message's text.

On macOS termslack runs `osascript`, on Linux `notify-send`; the text is passed as separate arguments, never built into a script or shell string, so quotes, backslashes and newlines can't break it. On other platforms, or if the tool isn't installed, the status bar says so once and the bell carries on alone. A notification command that fails is noted once; one that hangs is killed after 5 seconds. Neither blocks termslack.

### Presence

DMs show whether the other person is active or away, before their name: a green `●` for active, a dim `○` for away, and nothing while it isn't known. It appears in the sidebar's DM rows (in the cell just before the name, so names stay put, after the `▌` that marks the open conversation) and in the open DM's header (`● @Ana`). Your own presence isn't shown, and group DMs and bots aren't checked.

Slack doesn't send presence changes over Socket Mode to a user token, so termslack polls `users.getPresence` (the `users:read` scope), only for the people on screen: the DMs the sidebar currently draws (not those in a collapsed section, hidden by the recent-DMs filter, or scrolled out of the sidebar) and the open DM. The budget:

- a person is checked again no sooner than every 5 minutes;
- at most 20 calls a minute, one at a time and spread about 3 seconds apart, never a burst; someone who scrolls into view is checked at the next free slot;
- someone off screen for 10 minutes has their presence forgotten, so stale state never shows;
- a 429 that the Slack client's own retries couldn't outwait, or any other temporary failure, doubles the spacing (up to 16 times) until a call works and the person is tried again; nobody is dropped;
- errors about a person (`user_not_found`, ...) leave them unknown until the next refresh, and a missing permission ends the polling for the session; none of it shows in the status bar.

The polling stops when termslack quits.

### Sidebar sections

The sidebar is made of collapsible sections: your own, in the order you list them, then **Channels** (every channel no section claims), then **Direct messages**. Slack's own sections aren't available to a user token, so termslack keeps its own. Until the first change you make from inside termslack, they come from the workspace's part of `~/.config/termslack/config.toml`:

```toml
[workspaces.T0123ABCD]
recentDms = 10

[[workspaces.T0123ABCD.sections]]
name = "Work"
channels = ["#deploys", "eng", "C07MZ2P4HJ5"]

[[workspaces.T0123ABCD.sections]]
name = "Fun"
channels = ["random"]
```

Each entry is a channel name (with or without `#`, case-insensitive) or an ID. A channel listed in several sections goes in the first. A channel configured by ID keeps its section when it is renamed; one configured by name follows its current name. Names and IDs that match no channel you are in are ignored, and the status bar says so once the channel list has loaded (`not found in sections: #nope`). Malformed sections (no name, no `channels` list, a repeated name) are ignored. termslack never rewrites `config.toml` (the one exception is the theme line, see above), so your comments and key order are kept.

Moving channels: **Move to section…** in the channel menu (`m` then `s`) opens a second list in the same popup: your sections in order (the channel's current one marked with `✓`), `Channels (no section)` and `New section…`. `Enter`, a click or the item's key chooses (`1`-`9` for the first nine sections, `c` for Channels, `n` for New section) and the channel moves at once, the popup closes, and the sidebar redraws with the channel in its new place, still selected. `Esc` in the list goes back to the menu. `New section…` closes the menu and asks `New section:` on a line at the bottom; type a name and press `Enter` to add the section after your others with the channel in it. An empty name, or one a section already has, is refused with the reason on that line and the prompt stays open; `Esc` (or a click elsewhere) cancels the prompt, leaving nothing changed. A section left empty stays. Changes are kept as described next.

Where sections live now: the first time a section is changed from inside termslack (a channel put in or taken out of one, or a section created, from the channel menu), termslack copies the sections it is showing into the state file (`~/.local/state/termslack/state.toml`), per workspace, and reads them only from there from then on. Channels you listed by name are stored by channel ID, so a renamed channel keeps its section; names and IDs that matched no channel are dropped (they were already ignored), and the not-found warning no longer applies. After the copy a `sections` list left in `config.toml` is ignored, and the status bar says so once, when the copy happens (`Sections are now kept by termslack; the ones in config.toml are ignored`); later runs don't repeat it. Which sections are collapsed carries over, since section IDs don't change. A change that would change nothing (taking a channel out of sections it isn't in) doesn't trigger the copy. A section left empty stays, and a channel in several sections goes in the first, as before. Until a change is made, everything works exactly as described above.

Headings are selectable like conversations (the sidebar must be focused). On a heading, `Enter` or `Space` collapses or expands it, `←`/`h` collapses and `→`/`l` expands; `Enter` on a conversation still opens it. `▾` marks an expanded section and `▸` a collapsed one. A collapsed section hides its channels, except the open conversation, which stays listed under it. Its heading shows whether anything inside is unread (bold, bright white) and, as a red badge, how many mentions there are in all (for Direct messages, counting every DM, not just the listed ones). Which sections are collapsed is remembered per workspace in the state file (`~/.local/state/termslack/state.toml`), not in the config; the DM `a` toggle is still not remembered. Up/down moves over headings and the visible conversations, skipping hidden ones.

Help: `?` from any pane (but not in an input box, where it types a `?`) opens a popup over the panes (about 80% of the area, centred) listing every keyboard shortcut, grouped by where it works. `Esc` or `?` closes it and focus goes back where it was; while it is open it gets every key (`Ctrl+C` still quits), and when it is taller than the popup it scrolls with `j`/`k`, the arrows, `PgUp`/`PgDn` and `g`/`G`. Shortcuts are fixed for now (not customizable yet); they are all defined in one table, `src/ui/app/shortcuts.ts`, which the key handlers and the help screen both read. The help popup is built on a general overlay (`Overlay.tsx`, a compact or large popup with a filter line and a scrollable, selectable list, drawn over the panes) that later screens reuse.

Quick switcher: `Ctrl+K` from anywhere, including while typing in an input box (the input's text and your drafts are not touched), opens a compact popup near the top of the screen, over the panes, with a filter line over every channel, DM and group DM you're in (private channels are marked; archived ones are left out). Type a few letters and the list narrows to names containing them in order, ignoring case; `Backspace` widens it again, and `j`, `k`, `q` and `?` just type. Exact matches rank first, then prefixes, then matches at the start of a word (`dep` finds `#team-deploys`), then any other in-order match; ties go to conversations with unread messages, then the ones opened most recently. With nothing typed, the conversations you're in come first (the ones you opened most recently this run, then unread ones, then the rest by name), then the channels you aren't in, in that same order. Each result is styled like the sidebar (unread bold, a red count for mentions). `Up`/`Down` or `Ctrl+P`/`Ctrl+N` move the highlight, `PgUp`/`PgDn` page. `Enter` opens it exactly as the sidebar would (revealing it if its section is collapsed or the recent-DMs filter hides it), selects it in the sidebar and moves focus to its messages; `Esc` (or `Ctrl+K` again) closes the switcher and leaves focus and everything else as it was. `Ctrl+K` also works while the help, the search or the reaction prompt is open: it closes that and opens the switcher (the search keeps its query and results for `/`, as on `Esc`); while a `y/n` question is up it cancels the question. The switcher also finds people, so you can message anyone in the workspace: everyone from the workspace's people list that termslack loads in the background, except deleted users and bots (you are included, for your own self-DM). Someone you already have a DM with shows once, as the DM, and matches on their real name and username as well; someone without a DM shows by name with their real name or username alongside when it differs (`@Ray  Raymond Parker · rparker`) and matches on any of them. While the people list is still loading the title says so and the list holds the people known so far. `Enter` on a person without a DM asks Slack to open one (`conversations.open`, the `im:write` scope), adds it to the sidebar once (it counts as recently active, so the recent-DMs filter shows it) and opens it as above (unless you opened another conversation while Slack was answering, then it only lands in the sidebar); if Slack already had that DM it is used, never listed twice. If `im:write` is missing (when Slack reports the granted scopes) the people still show, but `Enter` explains in the status bar that starting DMs is off and to run setup again, without calling Slack; if Slack refuses (`user_not_found`, `user_disabled`, ...) the reason is shown there, the switcher closes and nothing changes. The switcher also finds the workspace's public channels you aren't in (archived ones left out). They are listed with `conversations.list` in the background the first time the switcher opens in a session, not at startup, and kept for the session; channels created, renamed, archived or deleted while termslack runs (the channel events) keep the list current. While it loads the title says so and the list holds what has arrived; if it fails the title says that and the next `Ctrl+K` tries again. These channels are dimmed and marked `not a member`, with their member count when Slack gives one (`#design  not a member · 8 members`), and rank below the conversations you're in with an equally good match (and last when nothing is typed). `Enter` on one asks `Join #design? y/n` in the status bar; `y` calls `conversations.join` (the `channels:write` scope, which the setup manifest already requests), adds the channel to the sidebar once, in the section your config names it in or else under Channels, and opens it with its history as for any conversation (the `member_joined_channel` echo for you doesn't add it again; if you opened another conversation while Slack was answering, termslack doesn't switch to the channel, it just lands in the sidebar); any other key cancels without calling Slack. If `channels:write` is missing (when Slack reports the granted scopes) `Enter` explains in the status bar that joining is off and to run setup again, and asks nothing; if Slack refuses (`is_archived`, `method_not_supported_for_channel_type`, ...) the reason is shown there and nothing changes.

Message search: `/` from any pane (in an input box it types a `/`) opens a large popup with a query line over the results. Type a query (Slack's own syntax works: `from:@name`, `in:#channel`, quotes, ...; letters like `j` and `k` just type) and press `Enter`: termslack calls `search.messages` (the `search:read` scope, already in the setup manifest), newest first, 20 per page, and lists the matches. Each result is five rows: a header with the conversation (named like the sidebar: `#channel`, `@person`, or a group DM's members; a channel termslack doesn't know shows the name Slack gave), the author, the date and time (and `reply in thread` for a thread reply), then the first three lines of the message, rendered as in the message pane (mentions by name, links, emoji, formatting), cut with `…`. `Up`/`Down` or `Ctrl+P`/`Ctrl+N` move the highlight and `PgUp`/`PgDn` page; reaching the last result loads the next page. The title shows the total match count, `searching…` and `loading more…` while Slack answers, and `end of results` when there are no more pages; an empty answer says `No messages match "query"`. Changing the query and pressing `Enter` starts a new search, and an older search that answers late is dropped, so it can never replace a newer one's results; `Enter` on a query that has been run opens the highlighted result (below). Slack refusing (`invalid_query`, `missing_scope`, a rate limit, ...) shows the reason in the overlay; a page that fails to load keeps the results already there and scrolling to the end tries it again. Names in the results (conversations, authors, mentioned people) that termslack doesn't know yet are looked up before the page is shown, like for any message. If `search:read` is missing (when Slack reports the granted scopes) `/` explains in the status bar instead of opening the prompt. `Esc` closes the search and leaves focus where it was; the session remembers the last query and its results, so `/` again starts with them.

Opening a result: `Enter` on a result closes the search and opens its conversation with the message selected and scrolled to the middle of the view, and moves focus to the messages; opening it counts as opening the conversation (the unread marker clears and Slack is told it's read, as for any conversation, once its history has loaded; that page always runs from the newest message back, so it includes the newest end; it's remembered as the last opened one, a collapsed sidebar section opens). The search keeps its query, results and highlight, so `/` brings them back to try the next result. Loaded history always runs without gaps from the newest message back (Slack's `conversations.history` returns newest first and can't start just after a message), so opening a result loads at most one page of 200 messages back from where history stands (unless the message and about ten before it are already loaded), merged by `ts` with what was loaded; scrolling up carries on from the same cursor, everything newer is already there, and the pane shows `Loading messages…` meanwhile. If the message isn't within that page, the conversation opens at the oldest message loaded and the status bar says the result is further back than the last 200 messages and that you can scroll up to load more. A thread reply opens its parent conversation with the parent selected and the thread pane open on the whole thread, the reply selected and focused; a thread parent (Slack's permalink carries its own `thread_ts` too) opens like any message, with no thread pane. A message deleted since is not shown: the conversation opens at the nearest earlier message and the status bar says `That message has been deleted.` A public channel you're not in opens read-only if Slack lets you read it (it isn't in the sidebar, its input says you're not a member and points to the quick switcher's join, and termslack doesn't mark it read); if Slack refuses, the reason is in the status bar. A conversation termslack can't look up isn't opened and the status bar says so.

Leaving a channel: with a channel or private channel selected in the sidebar, `x` asks `Leave #name? y/n` in the status bar (for a private channel it adds that you can't rejoin without an invite); `y` calls `conversations.leave` and any other key cancels without calling Slack. The channel disappears from the sidebar and the switcher's member list (a public channel then shows there as `not a member`, once the switcher's channel listing is loaded), and the selection moves to the entry that followed it. If it was the open conversation, the message pane, thread pane and input close as when nothing is open, its unsent draft is dropped, and it isn't reopened at the next start. `x` on a DM, group DM or section heading does nothing (on a DM the status bar says only channels can be left). `channel_left`, `group_left` and your own `member_left_channel` remove a channel the same way without asking, so leaving in the Slack app or on another device shows up here; the echo of termslack's own leave changes nothing more. Public channels need the `channels:write` scope and private ones `groups:write` (both in the setup manifest); when Slack reports the granted scopes and the one needed is missing, `x` explains in the status bar and asks nothing. If Slack refuses (`cant_leave_general`, `last_member`, `missing_scope`, ...) the reason is shown there and the channel stays. There is no live test for `conversations.leave`, since it would change your real channel membership; the fake's responses follow Slack's documented shape.

Channel menu: with a channel or private channel selected in the sidebar, `m` (or a right-click on its entry, which selects it without opening the conversation) opens a compact popup beside the entry, titled with the channel's name, listing what can be done to it; each item shows its letter. `j`/`k` or the arrows move the highlighted row, `Enter` or the item's letter chooses it, a left click on an item chooses it, the wheel moves the highlight, and `Esc` or a click outside closes the menu, back to the sidebar. Like every popup it takes all keys while open (`Ctrl+C` still quits). Its items so far: **Mute channel** / **Unmute channel** (`m`, see Muting a channel), **Channel details** (`d`), which closes the menu and opens a read-only popup with what Slack says about the channel, asked fresh each time, **Move to section…** (`s`, see Sidebar sections) and **Leave channel** (`l`), which closes the menu and asks the same `Leave #name? y/n` question as `x` (`x` still works on its own). The details popup shows the channel's name, whether it is public or private, its topic, description (Slack's purpose), who created it and when, its member count, its ID, the sidebar section it is in and whether it is muted (an empty topic or description reads `none`). Slack formatting in the topic and description (mentions, channel links, emoji, links) is shown as messages show it. It says `Loading…` while Slack answers and gives Slack's reason in the popup if it refuses; long text wraps, and it scrolls with `j`/`k`, `PgUp`/`PgDn`, `g`/`G` or the wheel. `Esc` or a click outside closes it, back to the sidebar. It needs no new permissions (`channels:read`, and `groups:read` for private channels, which termslack already asks for). `m` and a right-click on a DM, group DM or section heading do nothing.

Muting a channel: **Mute channel** in the channel menu (`m` then `m`; the item reads **Unmute channel** once it is muted) makes a channel quiet in termslack. Slack's API can't mute, so this is termslack's own: Slack and your other devices don't know, and termslack doesn't know what you muted in Slack. Muted channels are remembered per workspace, by channel ID (a renamed channel stays muted), in the state file (`~/.local/state/termslack/state.toml`), and muting or unmuting applies at once. A muted channel never rings the bell or shows a desktop notification, mentions included; it is drawn dimmed in the sidebar, in its usual section, and isn't bold when it has unread messages (nor does it make a collapsed section's heading bold); it still shows its red mention count, and its mentions still count in a collapsed heading's badge. The startup unread check skips it, and the quick switcher marks it `muted` but still finds it. Leaving a channel (here or on another device) forgets that it was muted. With the sidebar focused, `M` hides muted channels from the sidebar, or shows them again (muted channels show by default); the choice is remembered per workspace in the state file. While they are hidden, a muted channel with an unread mention shows anyway, in its section, until it has been read, and the open conversation stays listed even if it is muted (as under a collapsed section). The status bar's sidebar hints say `muted hidden` while they are, so a missing channel has an explanation; up/down skip hidden channels and mouse rows follow what is drawn. A section heading is bold for unread messages only by what it shows, while its mention count still counts every channel in the section.

Writing: `Tab` cycles sidebar, messages and the input box under the open conversation; `i` jumps straight to the input and `Esc` leaves it for the message pane. While the input has focus every key types (even `q` and `j`; `Ctrl+C` still quits). `Enter` sends; `Alt+Enter` and `Ctrl+J` insert a newline, and so does `Shift+Enter` in terminals that support the kitty keyboard protocol (termslack asks the terminal and falls back quietly). The box grows to five lines, then scrolls. Editing keys: arrows, `Home`/`End` (or `Ctrl+A`/`Ctrl+E`), `Alt+←/→` or `Alt+B/F` by word, `Backspace`, `Delete`, `Ctrl+W`. `&`, `<` and `>` are escaped so Slack shows them as typed. Typing `@` or `#` opens a short completion list above the box (people, user groups, `@here`/`@channel`/`@everyone`, channels); it narrows as you type, `Up`/`Down` choose, `Tab` or `Enter` completes and `Esc` closes just the list. Sent text carries real mentions: a completed one always maps to the person, group or channel you picked, a hand-typed `@name` or `#channel` converts only when exactly one matches (otherwise it stays plain text), and nothing converts inside email addresses or backticks. A sent message shows at once, dimmed, and turns normal when Slack confirms it (never twice, whichever of the response and the socket echo arrives first). If sending fails the reason is shown in the status bar, the message is marked `(not sent)` and the text goes back into the input; a `missing_scope` error says to run setup again to grant `chat:write`. Unsent text is kept per conversation while termslack runs. termslack reads the granted scopes from `auth.test` at startup; if `chat:write` is missing, the inputs show an explanation instead of taking text and sending, replying, editing and deleting are refused up front, and if `reactions:write` is missing `r` explains instead of opening the prompt (when Slack doesn't report scopes, nothing is switched off and a `missing_scope` refusal is explained when it comes). A send that fails in transit (a dropped connection, a timeout) after Slack posted it is treated as delivered once its echo is seen.

Threads: with the message pane focused, `Enter` or `t` on a message opens its thread beside the conversation (parent first, then every reply, drawn like the conversation; a reply also sent to the channel shows in both). Opening a thread loads all its replies, since Slack pages them oldest first; live replies appear as they arrive. The thread pane has its own selection (`j`/`k`, arrows, `PgUp`/`PgDn`, `g`/`G`), joins the `Tab` order after the input, and `Esc` closes it and returns to the messages; switching conversation closes it too. When the area beside the sidebar is under 100 columns the thread takes the conversation's place instead.

Replying: under the thread is a reply box, the same input as the conversation's (mentions, pending/confirmed/failed, escaping). With the thread pane focused, `i` jumps to it and `Esc` returns to the thread; `Tab` visits it after the thread. `Ctrl+T` while typing a reply toggles _also send to #channel_ (shown above the box; it resets after each send, and comes back if the send fails), so the reply shows in the thread and the channel. Starting a thread on a message with no replies opens the pane empty (nothing is fetched) with the reply box focused. A confirmed reply raises the parent's reply count at once, and its socket echo never counts again. Each thread keeps its own unsent draft while termslack runs, apart from the conversation's.

Editing and deleting: with the message pane or the thread pane focused, `e` on one of your own messages puts its text in that pane's input (mentions back as `@name`/`#channel`) under an _Editing_ notice. `Enter` saves through `chat.update`, `Esc` cancels, and the draft that was in the input before comes back untouched; saving unchanged text just leaves edit mode. `d` on one of your own messages asks `Delete this message? y/n` in the status bar; `y` deletes, any other key cancels. Both show at once (an edit as the new text marked `(edited)`, a delete as the message gone) and settle when Slack's echo arrives without applying twice. If Slack refuses (`cant_update_message`, `edit_window_closed`, `cant_delete_message`, `missing_scope`, ...) the message goes back exactly as it was and the reason shows in the status bar. On other people's messages (and bots') `e` and `d` only show a hint.

Reacting: with the message pane or the thread pane focused, `r` on any message (yours or anyone else's; not one still sending) opens an emoji prompt across the bottom of the screen, above the status bar. As you type a name it lists matching standard and custom emoji (names starting with what you typed first); `Up`/`Down` choose, `Enter` reacts with the chosen one (or with exactly what you typed when nothing matches), `Tab` copies the chosen name into the prompt so you can edit it, and `Esc` cancels. `tada` and `:tada:` both work, and skin tones are taken as typed (`+1::skin-tone-2`). The prompt says what `Enter` will do: _adds_ a reaction, or _removes_ it when you have already reacted with that emoji. A name Slack doesn't know is still tried; Slack answers `invalid_name` and the status bar says so. Your own reactions are drawn inverted in the reaction line, so you can see what a removal would affect. The change shows at once and Slack's `reaction_added`/`reaction_removed` echo settles it without counting twice. If Slack refuses (`too_many_reactions`, `invalid_name`, `missing_scope`, ...) the line goes back and the reason shows in the status bar; `already_reacted` and `no_reaction` just leave the line as you wanted it.

`--history` takes a channel name (`general` or `#general`), `@name` for an existing DM with that person, or a channel ID. It prints the latest 50 messages oldest first (thread parents show their reply count) and then carries on with live events. Names are matched among the conversations you're in; an unknown name lists close matches.

First run walks through setup:

1. Paste an **app configuration refresh token** (api.slack.com/apps → Your App Configuration Tokens). termslack uses it to create your personal app.
2. Paste an **app-level token** (`xapp-`, scope `connections:write`) from the new app's Basic Information page.
3. Authorize in the browser. Slack redirects back to a short-lived listener on `http://127.0.0.1:53682/callback`.

Later runs connect automatically. If a token gets revoked, termslack re-runs only the step it needs. When a new version of termslack changes the app manifest (scopes, events, redirect URL), it pushes the update to your existing app on startup, and asks you to sign in again if the permissions changed.

### Mouse

The mouse is always on; there is no option to turn it off. termslack asks the terminal to report mouse buttons, the wheel and pointer motion, and turns that off again however it exits.

- Click a pane, an input box or the sidebar to focus it (an input box with the cursor at the end of the draft).
- Click a sidebar entry to open it, or a section heading to fold it.
- Right-click a channel in the sidebar to select it and open its channel menu (click an item to choose it).
- Click a message to select it, or its "N replies" line to open the thread.
- Click a row in the switcher, search results, theme picker or channel menu to choose it. A click outside a popup closes it; a click during a `y/n` question cancels it.
- The wheel moves the selection under the pointer without moving focus.
- Hovering shades the sidebar row under the pointer.

With mouse reporting on, the terminal no longer selects text on a plain drag: hold `Shift` while dragging (`Option` in iTerm2) to select and copy as usual. Inside tmux, set `set -g mouse on` so clicks reach termslack.

## Develop

```bash
bun check            # type check
bun fmt              # format
bun run build        # single binary → dist/termslack
bun run build:release # all platforms → dist/release/ (archives + checksums.txt)
bun test             # unit + fake-Slack tests (no network)
bun run test:live    # tests against real Slack, using your stored workspace
```

Tests run against a fake Slack (`tests/support/fakeSlack.ts`): a `Bun.serve` that answers Web API methods and speaks Socket Mode over a websocket. `tests/setup.ts` points config at a temp directory, stores secrets in a file instead of the keychain, and disables browser launching, so tests never touch your real setup.

Environment overrides (also useful outside tests):

| Variable                                       | Effect                                                     |
| ---------------------------------------------- | ---------------------------------------------------------- |
| `TERMSLACK_SLACK_API_URL`                      | Send all Slack API and socket traffic to another server    |
| `TERMSLACK_SECRETS_BACKEND=file`               | Store tokens in `credentials.toml` instead of the keychain |
| `TERMSLACK_BROWSER=none`                       | Print URLs instead of opening a browser (handy over SSH)   |
| `TERMSLACK_APP_TOKEN` + `TERMSLACK_USER_TOKEN` | Skip setup entirely                                        |

## Releasing

For maintainers. Pushing a version tag builds, tests and publishes everything.

1. Bump `version` in `package.json` and add a `## X.Y.Z - date` section to `CHANGELOG.md` (it becomes the release notes).
2. Commit, then tag and push the tag: `git tag vX.Y.Z && git push origin vX.Y.Z`.

`.github/workflows/release.yml` then runs the tests, fails if the tag differs from `package.json`, builds the four archives, runs the macOS arm64 and Linux x64 binaries with `--version`, creates the GitHub Release with the archives, `checksums.txt` and the changelog notes, and finally updates `Formula/termslack.rb` in `TWithers/homebrew-tap`. A failure before the publish step publishes nothing.

One-time setup: create the `TWithers/homebrew-tap` repository, and add a repository secret `HOMEBREW_TAP_TOKEN` to `TWithers/termslack`: a fine-grained personal access token limited to `TWithers/homebrew-tap` with Contents: read and write. Only the tap step uses it. If the secret is missing the release is still published and only the tap job fails; add the secret and re-run that job.

## Where things live

| What                                                                                                             | Where                                                             |
| ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Config you edit (settings, `recentDms`, `sections` until termslack takes them over)                              | `~/.config/termslack/config.toml` (respects `XDG_CONFIG_HOME`)    |
| What termslack records and remembers (workspace and app IDs, open conversation, when each DM last had a message) | `~/.local/state/termslack/state.toml` (respects `XDG_STATE_HOME`) |
| Tokens and client secret                                                                                         | OS keychain, service `termslack`, one entry per team ID           |
| Fallback when no keychain exists                                                                                 | `~/.config/termslack/credentials.toml` (mode 0600)                |

Setup writes what it learns (team and user names and IDs, app ID, client ID, manifest hash, and which workspace is the default) to the state file, never to `config.toml`; on a fresh machine no `config.toml` exists and termslack runs on defaults. A `config.toml` from an older termslack that still holds those values keeps working: termslack reads each value from the state file first and falls back to the config. A `defaultWorkspace` you write in `config.toml` wins over the recorded one.

Set `TERMSLACK_APP_TOKEN` and `TERMSLACK_USER_TOKEN` to skip setup and the keychain entirely.
