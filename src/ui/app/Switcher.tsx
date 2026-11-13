import { Text } from "../SafeText";
import { theme } from "../theme";
import type { OverlayItem } from "./Overlay";
import { badgeText, entryStyle } from "./sidebarEntries";
import type { SwitcherCandidate } from "./switcherRanking";

/** What the keys do while the quick switcher is open; also shown by the status bar. */
export const switcherKeyHints =
  "type to filter · ↑/↓ or Ctrl+P/Ctrl+N choose · Enter open · Esc close";

/** One result row: the name styled like the sidebar's (unread bold, mentions with a red count), and any note. */
export function switcherItem(
  { id, label, markers, note, notMember, muted }: SwitcherCandidate,
  selected: boolean,
): OverlayItem {
  const style = entryStyle(markers, {
    selected,
    open: false,
    focused: true,
    muted,
  });
  const badge = badgeText(markers);
  const color = notMember && !selected ? theme.secondaryText : style.color;

  return {
    key: id,
    node: (
      <Text wrap="truncate">
        <Text
          bold={style.bold}
          color={color}
          backgroundColor={style.backgroundColor}
        >
          {label}
        </Text>
        {note ? <Text color={theme.secondaryText}>{` ${note}`}</Text> : null}
        {badge ? (
          <Text>
            {" "}
            <Text
              color={theme.mentionBadgeText}
              backgroundColor={theme.mentionBadgeBackground}
              bold
            >
              {badge}
            </Text>
          </Text>
        ) : null}
      </Text>
    ),
  };
}
