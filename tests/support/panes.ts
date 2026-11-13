/**
 * The sidebar's rows from a screen: the lines between its top and bottom
 * border, without the side borders. `width` is the sidebar's whole width
 * (border included). Row `n` is on screen row `n + 1`.
 */
export function sidebarRows(screen: string, width = 32): string[] {
  const lines = screen.split("\n");
  const bottom = lines.findIndex((line) => line.startsWith("╰"));

  return lines
    .slice(1, bottom < 0 ? undefined : bottom)
    .map((line) => line.slice(1, width - 1));
}
