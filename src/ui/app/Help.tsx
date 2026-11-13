import { Text } from "../SafeText";
import { cellWidth } from "../terminalSafeText";
import { theme } from "../theme";
import type { OverlayItem } from "./Overlay";
import { type Run, wrapRuns } from "./wrap";
import { shortcutGroups, shortcutLabel, shortcuts } from "./shortcuts";

/** What the keys do while the help screen is open; also shown by the status bar. */
export const helpKeyHints =
  "j/k scroll · PgUp/PgDn page · g/G top/bottom · Esc or ? close";

const indent = 2;
const gutter = 2;

const lineText = (line: Run[]) => line.map((run) => run.text).join("");

const plain = (text: string): Run[] => [{ text }];

/**
 * The help screen's lines for a list `width` columns wide, built from the
 * shortcut table: each group's heading, then its shortcuts. The key column is
 * as wide as the longest label, up to a third of `width`, and a longer label
 * wraps inside it; a description that doesn't fit wraps under itself, aligned
 * with the description column. Every item is one screen line, so the list
 * scrolls and counts in lines.
 */
export function helpItems(width = 1000): OverlayItem[] {
  const widest = Math.max(
    ...shortcuts.map((shortcut) => cellWidth(shortcutLabel(shortcut))),
  );
  const labelWidth = Math.max(1, Math.min(widest, Math.floor(width / 3)));
  const descriptionWidth = Math.max(1, width - indent - labelWidth - gutter);

  return shortcutGroups.flatMap(({ id, title }, index) => [
    ...(index === 0
      ? []
      : [{ key: `gap:${id}`, node: <Text color={theme.text}> </Text> }]),
    {
      key: `group:${id}`,
      node: (
        <Text bold color={theme.brightText} wrap="truncate">
          {title}
        </Text>
      ),
    },
    ...shortcuts
      .filter((shortcut) => shortcut.group === id)
      .flatMap((shortcut) => {
        const labels = wrapRuns(plain(shortcutLabel(shortcut)), labelWidth);
        const descriptions = wrapRuns(
          plain(shortcut.description),
          descriptionWidth,
        );

        return Array.from(
          { length: Math.max(labels.length, descriptions.length) },
          (_, line) => {
            const label = lineText(labels[line] ?? []);
            const padding = " ".repeat(labelWidth - cellWidth(label));

            return {
              key: line === 0 ? shortcut.id : `${shortcut.id}:${line}`,
              node: (
                <Text wrap="truncate" color={theme.text}>
                  <Text color={theme.helpKeyText}>
                    {`${" ".repeat(indent)}${label}${padding}${" ".repeat(gutter)}`}
                  </Text>
                  {lineText(descriptions[line] ?? [])}
                </Text>
              ),
            };
          },
        );
      }),
  ]);
}
