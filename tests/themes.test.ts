import { afterEach, describe, expect, test } from "bun:test";
import { chosenThemeName } from "../src/config/config";
import { legibleColour } from "../src/ui/authorColour";
import { contrastRatio, minimumContrast } from "../src/ui/colour";
import { omarchyPalettes } from "../src/ui/omarchyPalettes";
import {
  applyTheme,
  defaultThemeName,
  slackDark,
  theme,
  themeNamed,
  themeNames,
} from "../src/ui/theme";

afterEach(() => void applyTheme(defaultThemeName));

const hex = /^#[0-9a-f]{6}$/;

const omarchyNames = [
  "catppuccin",
  "catppuccin-latte",
  "ethereal",
  "everforest",
  "flexoki-light",
  "gruvbox",
  "hackerman",
  "jade-horse",
  "kanagawa",
  "last-horizon",
  "lumon",
  "lupine",
  "matte-black",
  "miasma",
  "nord",
  "retro-82",
  "ristretto",
  "rose-pine",
  "solitude",
  "starship",
  "tokyo-night",
  "vantablack",
  "white",
];

test("the built-in theme and all 23 of Omarchy's can be chosen by name", () => {
  expect(themeNames).toEqual([defaultThemeName, ...omarchyNames]);
  expect(defaultThemeName).toBe("slack-dark");
});

describe("applyTheme", () => {
  test("makes `theme` the named theme, and the default again", () => {
    expect(theme).toBe(slackDark);

    expect(applyTheme("nord")).toBe(true);
    expect(theme).toEqual(themeNamed("nord")!);
    expect(theme.paneBackground).toBe(omarchyPalettes.nord!.background);

    expect(applyTheme(defaultThemeName)).toBe(true);
    expect(theme).toBe(slackDark);
  });

  test("leaves the theme alone for an unknown name", () => {
    applyTheme("nord");

    expect(applyTheme("not-a-theme")).toBe(false);
    expect(applyTheme("constructor")).toBe(false);
    expect(theme.paneBackground).toBe(omarchyPalettes.nord!.background);
  });

  test("changes what a default background reads, for names", () => {
    applyTheme("catppuccin-latte");

    const result = legibleColour(theme.paneBackground);

    expect(contrastRatio(result, theme.paneBackground)).toBeGreaterThanOrEqual(
      minimumContrast,
    );
    expect(result).not.toBe(legibleColour(slackDark.paneBackground));
  });
});

describe("chosenThemeName", () => {
  test("is nothing when unset and the value otherwise, so a bad one can be named", () => {
    expect(chosenThemeName(undefined)).toBeUndefined();
    expect(chosenThemeName("nord")).toBe("nord");
    expect(chosenThemeName(5)).toBe("5");
    expect(chosenThemeName(true)).toBe("true");
  });
});

describe.each(omarchyNames)("the %s theme", (name) => {
  const palette = omarchyPalettes[name]!;
  const themed = themeNamed(name)!;

  test("is complete, with every value an exact #rrggbb colour", () => {
    expect(Object.keys(themed)).toEqual(Object.keys(slackDark));

    for (const [key, value] of Object.entries(themed)) {
      for (const colour of [value].flat()) {
        expect(colour, key).toMatch(hex);
      }
    }

    expect(themed.fallbackNameColours.length).toBeGreaterThan(0);
  });

  test("keeps the palette's own colours where it can", () => {
    expect(themed.paneBackground).toBe(palette.background);
    expect(themed.sidebarBackground).toBe(palette.darkBackground);
    expect(themed.selectionBackground).toBe(palette.selection);
    expect(themed.focus).toBe(palette.accent);
    expect(themed.linkText).toBe(palette.blue);
  });

  test("text, secondary text and bright text read on every background they sit on", () => {
    const backgrounds = [
      themed.paneBackground,
      themed.sidebarBackground,
      themed.popupBackground,
    ];

    for (const background of backgrounds) {
      for (const colour of [
        themed.text,
        themed.secondaryText,
        themed.mutedChannelText,
        themed.brightText,
      ]) {
        expect(
          contrastRatio(colour, background),
          `${colour} on ${background}`,
        ).toBeGreaterThanOrEqual(minimumContrast);
      }
    }
  });

  test("selection, badge, mention, code and reaction text read on their backgrounds", () => {
    const pairs = [
      [themed.selectionText, themed.selectionBackground],
      [themed.mentionBadgeText, themed.mentionBadgeBackground],
      [themed.mentionOfYouText, themed.mentionOfYouBackground],
      [themed.mentionText, themed.mentionBackground],
      [themed.broadcastText, themed.broadcastBackground],
      [themed.inlineCodeText, themed.inlineCodeBackground],
      [themed.codeBlockText, themed.codeBlockBackground],
      [themed.reactionText, themed.reactionBackground],
      [themed.ownReactionText, themed.ownReactionBackground],
      [themed.cursorText, themed.cursorBackground],
      [themed.sidebarHeadingText, themed.sidebarBackground],
    ] as const;

    for (const [colour, background] of pairs) {
      expect(
        contrastRatio(colour, background),
        `${colour} on ${background}`,
      ).toBeGreaterThanOrEqual(minimumContrast);
    }
  });

  test("hover and the highlights are a visible step from the backgrounds they sit on", () => {
    expect(themed.sidebarHoverBackground).not.toBe(themed.sidebarBackground);
    expect(
      contrastRatio(themed.sidebarHoverBackground, themed.sidebarBackground),
    ).toBeGreaterThanOrEqual(1.1);
    expect(themed.sidebarHoverBackground).not.toBe(
      themed.unfocusedSelectionBackground,
    );
    expect(themed.sidebarHoverBackground).not.toBe(themed.selectionBackground);
    expect(themed.mentionOfYouBackground).not.toBe(themed.paneBackground);
    expect(themed.mentionBackground).not.toBe(themed.paneBackground);
    expect(themed.inlineCodeBackground).not.toBe(themed.paneBackground);
  });
});
