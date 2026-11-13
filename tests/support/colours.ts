import { afterAll, beforeAll } from "bun:test";
import chalk from "chalk";

/** Makes Ink write colour codes for the tests of this file (it only does when it thinks the terminal has colour). */
export function useTerminalColour(): void {
  let level: typeof chalk.level;

  beforeAll(() => {
    level = chalk.level;
    chalk.level = 3;
  });

  afterAll(() => {
    chalk.level = level;
  });
}

/** The escape that sets a 24-bit foreground colour, as Ink writes it. */
export function foregroundCode(colour: string): string {
  const [red, green, blue] = [1, 3, 5].map((at) =>
    Number.parseInt(colour.slice(at, at + 2), 16),
  );

  return `\u001b[38;2;${red};${green};${blue}m`;
}

/** The row of `rows` (a coloured screen) whose text contains `text`. */
export function rowWith(rows: string[], text: string): string | undefined {
  return rows.find((row) => Bun.stripANSI(row).includes(text));
}

/**
 * The foreground colour escape in force where the `occurrence`th (from 0)
 * `text` starts in `row` (a coloured screen row), if there is one.
 */
export function foregroundAt(
  row: string,
  text: string,
  occurrence = 0,
): string | undefined {
  let at = -1;

  for (let seen = 0; seen <= occurrence; seen++) {
    at = row.indexOf(text, at + 1);

    if (at < 0) {
      return undefined;
    }
  }

  return row
    .slice(0, at)
    .match(/\u001b\[38;2;\d+;\d+;\d+m/g)
    ?.at(-1);
}
