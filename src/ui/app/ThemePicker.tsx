import { Text } from "../SafeText";
import { theme } from "../theme";
import type { OverlayItem } from "./Overlay";
import type { ThemeChoice } from "./themeChoices";

/** What the keys do while the theme picker is open; also shown by the status bar. */
export const themeKeyHints =
  "type to filter · ↑/↓ or Ctrl+P/Ctrl+N preview · Enter keep and save · Esc restore";

/** One row: the theme's name, with `light` for a light theme and `in use` for the theme the picker opened over. */
export function themeItem(
  { name, light }: ThemeChoice,
  { selected, inUse }: { selected: boolean; inUse: boolean },
): OverlayItem {
  const notes = [light ? "light" : undefined, inUse ? "in use" : undefined]
    .filter(Boolean)
    .join(" · ");

  return {
    key: name,
    node: (
      <Text wrap="truncate">
        <Text
          color={selected ? theme.selectionText : theme.text}
          backgroundColor={selected ? theme.selectionBackground : undefined}
        >
          {name}
        </Text>
        {notes ? <Text color={theme.secondaryText}>{` ${notes}`}</Text> : null}
      </Text>
    ),
  };
}
