# termslack

A terminal client for one Slack workspace: read and write in your channels and DMs from the keyboard (and the mouse), without the Slack app.

## Language

### Conversations

**Conversation**:
Anything messages are posted in: a channel (public or private), a DM, or a group DM.
_Avoid_: Chat, room

**Open conversation**:
The one conversation whose messages the message pane shows.
_Avoid_: Current channel, active chat

### Screen

**Sidebar**:
The list of conversations down the left side, grouped into sections.

**Sidebar entry**:
One conversation's row in the sidebar.
_Avoid_: Item, channel row

**Section**:
A named, collapsible group of sidebar entries: the user's own sections (which channels go in each is kept by termslack and changed from the channel menu), then Channels (every channel no section claims), then Direct messages.
_Avoid_: Folder, group, category

**Section heading**:
The row that names a sidebar section and collapses or expands it. Not a sidebar entry.

**Pane**:
One of the scrolling areas that show messages: the message pane (the open conversation) or the thread pane (one thread beside it). Drawn as a bordered box with its title on the border and its input box inside, under a divider.

**Input box**:
Where a message is written, under the message pane or the thread pane.
_Avoid_: Composer, text field

**Popup**:
A box drawn over the panes that takes every key until it closes: the help, the quick switcher, search results, the reaction prompt, the channel menu, channel details.
_Avoid_: Overlay, modal, dialog

**Channel menu**:
The popup listing what can be done to the selected channel in the sidebar: mute or unmute, move to a section, channel details, leave. Channels only (public and private), not DMs or headings.
_Avoid_: Context menu, actions menu

**Channel details**:
The read-only popup describing one channel: name, public or private, topic, description, creator and creation date, member count, ID, its section and whether it's muted.
_Avoid_: Channel info, details modal

**Status line**:
The message pane's bottom border: one-line questions such as "Leave #x? y/n" first, then notices and warnings, then the keys for whatever has focus. The connection shows on the sidebar's bottom border instead.
_Avoid_: Status bar (there is no longer a separate bottom line)

**Theme**:
termslack's own colours for every part of the screen: each part's background, text and hover colours. termslack paints the whole screen with it instead of relying on the terminal's colours.
_Avoid_: Colour scheme, palette, skin

### Attention

**Focus**:
Which pane, input box or popup keys go to. Exactly one thing has it.

**Selected message**:
The one message in a pane that message actions (reply, edit, delete, react) apply to. Each pane has its own.
_Avoid_: Cursor, current message

**Highlighted row**:
The row in a popup's list that Enter would choose.
_Avoid_: Selected result

**Hover**:
The sidebar entry or row the mouse pointer is over. It only shows where the pointer is and never changes focus or selection.
_Avoid_: Mouse-over, highlight

**Muted channel**:
A channel the user muted in termslack (Slack's API can't mute, so Slack and other clients don't know): it never rings or notifies, is drawn dimmed, isn't bolded when unread, and still shows its mention badge. Muted channels can be hidden from the sidebar as a whole; one with an unread mention shows anyway until it's read.
_Avoid_: Silenced, snoozed (snooze is Slack's Do Not Disturb)
