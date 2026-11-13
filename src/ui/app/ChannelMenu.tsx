import { Text } from "../SafeText";
import { theme } from "../theme";
import type { OverlayItem } from "./Overlay";

/** What the keys do while the channel menu is open; drawn on its bottom border. */
export const channelMenuKeyHints =
  "j/k or ↑/↓ move · Enter/letter choose · Esc close";

/** One row: the item's letter, then its label. */
export function channelMenuItem(
  { id, letter, label }: { id: string; letter: string; label: string },
  selected: boolean,
): OverlayItem {
  return {
    key: id,
    node: (
      <Text wrap="truncate">
        <Text color={selected ? theme.selectionText : theme.secondaryText}>
          {`${letter} `}
        </Text>
        <Text
          color={selected ? theme.selectionText : theme.text}
          backgroundColor={selected ? theme.selectionBackground : undefined}
        >
          {label}
        </Text>
      </Text>
    ),
  };
}
