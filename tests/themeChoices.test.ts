import { expect, test } from "bun:test";
import { themeNames } from "../src/ui/theme";
import { allThemeChoices, themeChoices } from "../src/ui/app/themeChoices";

const names = (filter: string) => themeChoices(filter).map(({ name }) => name);

test("slack-dark comes first, then every other theme alphabetically", () => {
  const listed = names("");

  expect(listed[0]).toBe("slack-dark");
  expect(listed.slice(1)).toEqual([...listed.slice(1)].sort());
  expect(listed.toSorted()).toEqual([...themeNames].sort());
});

test("light themes are marked", () => {
  const light = allThemeChoices()
    .filter((choice) => choice.light)
    .map(({ name }) => name);

  expect(light).toEqual([
    "catppuccin-latte",
    "flexoki-light",
    "lupine",
    "rose-pine",
    "white",
  ]);
});

test("the filter keeps names with its letters in order, ignoring case, best match first", () => {
  expect(names("NORD")).toEqual(["nord"]);
  expect(names("cat")).toEqual(["catppuccin", "catppuccin-latte"]);
  expect(names("lat")[0]).toBe("catppuccin-latte");
  expect(names("zzz")).toEqual([]);
});
