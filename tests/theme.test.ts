import { expect, test } from "bun:test";
import { Glob } from "bun";
import { type Theme, theme } from "../src/ui/theme";

const hex = /^#[0-9a-f]{6}$/;

/** Luminance 0..1, enough to order a background against another. */
function brightness(colour: string): number {
  const [red, green, blue] = [1, 3, 5].map((at) =>
    Number.parseInt(colour.slice(at, at + 2), 16),
  );

  return (0.2126 * red! + 0.7152 * green! + 0.0722 * blue!) / 255;
}

test("every theme value is an exact #rrggbb colour", () => {
  for (const [name, value] of Object.entries(theme)) {
    for (const colour of [value].flat()) {
      expect(colour, name).toMatch(hex);
    }
  }
});

test("the sidebar is a little darker than the pane, and hover is a small step from the sidebar", () => {
  const { sidebarBackground, paneBackground, sidebarHoverBackground } = theme;

  expect(brightness(sidebarBackground)).toBeLessThan(
    brightness(paneBackground),
  );
  expect(brightness(sidebarHoverBackground)).toBeGreaterThan(
    brightness(sidebarBackground),
  );
  expect(sidebarHoverBackground).not.toBe(sidebarBackground);
});

test("a theme is a plain object of named values, so another one only supplies different values", () => {
  const darker: Theme = { ...theme, paneBackground: "#000000" };

  expect(Object.keys(darker)).toEqual(Object.keys(theme));
});

/** The plain `--log` output colours a terminal stream, not the screen termslack paints. */
const plainLog = "src/ui/eventLog.ts";

const colourNames = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "gray",
  "grey",
  "blackBright",
  "redBright",
  "greenBright",
  "yellowBright",
  "blueBright",
  "magentaBright",
  "cyanBright",
  "whiteBright",
];

/** The built-in theme, and Omarchy's palettes copied as data. */
const allowed = ["src/ui/theme.ts", "src/ui/omarchyPalettes.ts", plainLog];

const hardCoded: [string, RegExp][] = [
  ["a hex colour", /#[0-9a-fA-F]{3,8}\b/],
  ["a colour name", new RegExp(`["'\`](${colourNames.join("|")})["'\`]`)],
  ["dimColor", /\bdimColor\b/],
  ["inverse", /\binverse\b/],
  ["a colour prop with a literal", /\b(color|backgroundColor|borderColor)="/],
];

test("no colour is hard-coded in the UI outside the theme", async () => {
  const found: string[] = [];

  for await (const path of new Glob("src/ui/**/*.{ts,tsx}").scan(".")) {
    if (allowed.includes(path)) {
      continue;
    }

    const lines = (await Bun.file(path).text()).split("\n");

    lines.forEach((line, index) => {
      for (const [what, pattern] of hardCoded) {
        if (pattern.test(line)) {
          found.push(`${path}:${index + 1} has ${what}: ${line.trim()}`);
        }
      }
    });
  }

  expect(found).toEqual([]);
});
