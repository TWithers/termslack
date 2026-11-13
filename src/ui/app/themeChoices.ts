import { defaultThemeName, isLightTheme, themeNames } from "../theme";
import { bestMatch, normalizeFilter } from "./switcherRanking";

/** One theme the picker lists. */
export type ThemeChoice = {
  name: string;
  /** Shown with a `light` note. */
  light: boolean;
};

/** Every theme: `slack-dark` first, then the others alphabetically. */
export function allThemeChoices(): ThemeChoice[] {
  const others = themeNames
    .filter((name) => name !== defaultThemeName)
    .sort((a, b) => a.localeCompare(b));

  return [defaultThemeName, ...others].map((name) => ({
    name,
    light: isLightTheme(name),
  }));
}

/**
 * The themes whose names the filter matches (its letters in order, ignoring
 * case), in the picker's order, with an exact or better match ahead of a
 * looser one. With no filter, all of them.
 */
export function themeChoices(filter: string): ThemeChoice[] {
  const query = normalizeFilter(filter);
  const all = allThemeChoices();

  if (query === "") {
    return all;
  }

  return all
    .flatMap((choice) => {
      const match = bestMatch([choice.name], query);

      return match === undefined ? [] : [{ choice, match }];
    })
    .sort((a, b) => a.match - b.match)
    .map(({ choice }) => choice);
}
