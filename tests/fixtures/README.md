# Fixtures

Each file is a JSON array of Socket Mode envelope payloads (the `payload` of an envelope, which is what `termslack --raw` prints one per line).

The current fixtures are derived from the example payloads in Slack's event reference (https://docs.slack.dev/reference/events/), not from real captures. Re-record them from real workspaces:

```bash
bun start --raw > capture.jsonl      # use the workspace, then Ctrl+C
bun scripts/sanitize-fixtures.ts capture.jsonl tests/fixtures/<name>.json
```

The sanitizer replaces names, message text, IDs, tokens and URLs with placeholders. The same real value always gets the same placeholder, so references between payloads still line up. Check the output before committing it.

## Web API responses and channel events

`users-conversations-*.json` and `conversations-info-*.json` hold Web API response bodies (not envelopes). `channel-*.json`, `group-*.json` and `member-joined-channel.json` hold events. All are derived from the examples in Slack's docs (docs.slack.dev/reference/methods/users.conversations, `conversations.info`, and the `channel_*`, `group_*` and `member_joined_channel` event pages), not from real captures. `users-conversations-channels` and `users-conversations-dms` are two consecutive pages of one listing.

## People, bots and group-DM members

`users-info.json`, `users-list.json` (two consecutive pages), `bots-info.json` and `conversations-members-mpim.json` hold Web API response bodies. `user-change.json`, `user-profile-changed.json`, `user-status-changed.json` and `team-join.json` hold events. They follow the example payloads in docs.slack.dev (`users.info`, `users.list`, `bots.info`, `conversations.members`, the `user_change`, `user_profile_changed`, `user_status_changed` and `team_join` event pages) with IDs adjusted to line up with the other fixtures; they are not real captures. `bot-message.json` (the `bot_message` event page) is reused for bot authors.

`conversations-list-public.json` is two consecutive pages of a `conversations.list` response (`types=public_channel`, archived excluded) with full channel objects (`is_member`, `num_members`, `previous_names`, ...), two channels the user is in (`general`, `random`) and two they aren't (`design`, `devops`). `conversations-join.json` holds two `conversations.join` response bodies for `#design`: joining it, then the same channel again with `warning: already_in_channel` and `response_metadata.warnings`, as Slack answers when the user is already in it. Both follow the examples in docs.slack.dev/reference/methods/conversations.list and `conversations.join`; not real captures.

`member-left-channel.json` is a `member_left_channel` event for the current user leaving `#general`, following docs.slack.dev/reference/events/member_left_channel (the same shape as `member-joined-channel.json`, minus the inviter); not a real capture. `conversations.leave` responses (`{ok: true}`, `{ok: true, not_in_channel: true}`, `{ok: false, error: "cant_leave_general"}`, ...) are built inline in `tests/leaveChannel.test.ts` and `tests/leaveFromSidebar.test.ts`, following docs.slack.dev/reference/methods/conversations.leave. There is no live test for it: it would change the real user's membership.

`conversations-open.json` holds two `conversations.open` response bodies for one user (`users` with a single ID, no `return_im`): the DM just created, then the same DM again with `no_op` and `already_open`, as Slack answers when it exists. Shaped like the examples in docs.slack.dev/reference/methods/conversations.open; not real captures.

## Message text

`usergroups-list.json` is the example response from docs.slack.dev/reference/methods/usergroups.list (not a real capture). The message texts in `tests/messageText.test.ts` follow Slack's formatting reference (https://docs.slack.dev/messaging/formatting-message-text): `<@U123>`, `<#C123|general>`, `<!here>`, `<!subteam^S123|@label>`, `<!date^...|fallback>`, `<url|label>`, `<mailto:...|...>` and the three escaped characters. The malformed cases are invented.

## Message lifecycle

`message-attachments.json` (the attachment fields from https://docs.slack.dev/messaging/formatting-message-text legacy attachment reference: `fallback`, `pretext`, `title`, `text`), `message-blocks.json` and `message-blocks-empty.json` (header, section, context and divider blocks from the Block Kit reference, https://docs.slack.dev/reference/block-kit/blocks), `message-rich-text.json` (the `rich_text` block shape with text, user, link and emoji elements), `message-file-share.json` and `message-file-share-no-text.json` (the `file_share` subtype with a `files` array, https://docs.slack.dev/reference/events/message/file_share), `thread-reply.json` (a parent and a reply carrying `thread_ts`, in the style of the `thread_broadcast` event page), `message-subtype-unknown.json` (the `channel_topic` subtype), `message-deleted-previous.json` (`message_deleted` with `previous_message`) and `message-changed-blocks.json` (`message_changed` whose new message has only an attachment) are all adapted from the examples in docs.slack.dev, not real captures. `message-attachment-no-fallback.json` and the malformed payloads in `tests/messageLifecycle.test.ts` are invented. Reactions on stored messages reuse `reaction-added.json`, with the message sent first.

## Emoji

`emoji-list.json` is a response body shaped like docs.slack.dev/reference/methods/emoji.list (plain URLs for custom emoji, `alias:name` for aliases). `emoji-changed.json` holds `emoji_changed` events (add, add as an alias, remove, rename) following docs.slack.dev/reference/events/emoji_changed. Neither is a real capture. Standard shortcodes come from the `emoji-datasource` package, not from fixtures.

## History

`conversations-history.json` and `conversations-replies.json` are each two consecutive pages of a Web API response (history is newest first, replies oldest first with the thread parent leading the first page). They follow the examples in docs.slack.dev/reference/methods/conversations.history and `conversations.replies` (`messages`, `has_more`, `response_metadata.next_cursor`, and `reply_count`, `latest_reply`, `reply_users` on a thread parent), with IDs adjusted to line up with the other fixtures, plus a bot message and an edited message. They are not real captures.

## User groups

`subteam-events.json` holds a `subteam_members_changed`, a `subteam_self_added` and a `subteam_self_removed` event following docs.slack.dev/reference/events (IDs adjusted to line up with the other fixtures). `usergroups-list.json` has no `users` arrays, since the docs example doesn't; the membership tests build `usergroups.list` responses with `users` inline, shaped like the response to `include_users=true`. Neither is a real capture.

## Message formatting

`tests/messageFormatting.test.ts` builds `rich_text` blocks inline: `rich_text_section`, `rich_text_list` (`style`, `indent`, `offset`), `rich_text_quote`, `rich_text_preformatted` and the element `style` object (`bold`, `italic`, `strike`, `code`), as described in https://docs.slack.dev/reference/block-kit/blocks/rich-text-block and its element pages. The mrkdwn rules follow https://docs.slack.dev/messaging/formatting-message-text (word boundaries are Slack's observed behaviour, as the docs don't state them). Not real captures.

## Attachments and Block Kit layout

`message-attachment-signup.json` is a `bot_message` shaped like a real integration message (a rich_text block, a green legacy attachment with a title and nine short title/value fields), with every name, email, ID and URL replaced by a placeholder; the shape was taken from a real capture, the values are invented. The attachment cases in `tests/attachments.test.ts` follow the legacy attachment reference (https://docs.slack.dev/messaging/formatting-message-text, and https://docs.slack.dev/legacy/legacy-messaging/legacy-secondary-message-attachments/: `color` as hex or `good`/`warning`/`danger`, `pretext`, `author_name`/`author_link`, `title`/`title_link`, `text`, `fields` with `short`, `image_url`, `thumb_url`, `footer`, `ts`). The Block Kit cases in `tests/blockKit.test.ts` follow the examples on https://docs.slack.dev/reference/block-kit/blocks (header, section with fields and accessory, context, divider, image, actions) and the block element pages (button, static_select, overflow, datepicker, image). The unknown and malformed blocks are invented. Not real captures.

## Message search

`search-messages.json` is two consecutive pages of a `search.messages` response body (`sort=timestamp`, `sort_dir=desc`): a channel message with a mention and an emoji, a DM message with a link, a thread reply in `#random` (its permalink carries `?thread_ts=`), and, on page two, a message in a channel the user isn't in from someone termslack doesn't know. No real capture of `search.messages` exists yet, so it is built from the example in docs.slack.dev/reference/methods/search.messages (`query`, `messages.total`, `messages.paging`, `messages.pagination`, and per match `iid`, `team`, `score`, `type`, `user`, `username`, `ts`, `text`, `permalink` and a `channel` object with the `is_*` flags, `name`, `pending_shared`) with IDs adjusted to line up with the other fixtures, and the DM's `channel.user` and the thread reply's `permalink` query added as Slack's search results are known to have them. Checked against real search results on 2026-11-09 (structure only): matches carry no `thread_ts` field, the permalink's `thread_ts` is present for thread parents (equal to the match's own `ts`) as well as replies, and DM matches' `channel` has `user`. The DM catch-up tests build their small `search.messages` responses inline.

## Do Not Disturb

`dnd-info.json` holds two `dnd.info` response bodies, following the example in docs.slack.dev/reference/methods/dnd.info: scheduled hours with a snooze under way (`snooze_enabled`, `snooze_endtime`, `snooze_remaining`), and scheduled hours without one (the snooze fields are left out, as Slack leaves them out when not snoozing). `dnd-updated.json` holds a `dnd_updated` event for the current user and a `dnd_updated_user` event for someone else, following docs.slack.dev/reference/events/dnd_updated and `dnd_updated_user` (`dnd_status` carries the snooze fields only on `dnd_updated`). The timestamps are the docs' fixed ones; tests that need a window around "now" build the status inline from the same field names. Not real captures. The live contract test (`tests/live/dnd.live.test.ts`) checks the real `dnd.info` shape.

## Presence

`users-get-presence.json` holds three `users.getPresence` response bodies following docs.slack.dev/reference/methods/users.getPresence: someone else who is `active`, someone else who is `away` (for another user the response carries only `presence`), and the user's own presence, which also has `online`, `auto_away`, `manual_away`, `connection_count` and `last_activity`. Not real captures. The presence tests build their error answers (`user_not_found`, `missing_scope`, a 429 with `Retry-After`) inline. The live contract test (`tests/live/presence.live.test.ts`) checks the real shape for the user's own ID, read-only.
