import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import {
  loadConfig,
  saveThemeChoice,
  withThemeLine,
} from "../src/config/config";
import { configFile } from "../src/config/paths";

beforeEach(() => rm(configFile, { force: true, recursive: true }));
afterEach(() => rm(configFile, { force: true, recursive: true }));

test("an existing theme line is replaced and the rest is left as written", () => {
  const text =
    '# my termslack\nbell = false\ntheme = "nord" # cold\nkittyKeyboard = true\n\n[workspaces.T1]\nname = "Acme"\n';

  expect(withThemeLine(text, "gruvbox")).toBe(
    '# my termslack\nbell = false\ntheme = "gruvbox"\nkittyKeyboard = true\n\n[workspaces.T1]\nname = "Acme"\n',
  );
});

test("a theme line under a section is not the top-level one", () => {
  const text = '[workspaces.T1]\ntheme = "nord"\n';

  expect(withThemeLine(text, "white")).toBe(
    'theme = "white"\n\n[workspaces.T1]\ntheme = "nord"\n',
  );
});

test("a new theme line goes above the first top-level key and the comment on it", () => {
  const text =
    '# ring the bell\nbell = false\n\n# the workspaces\n[workspaces.T1]\nname = "Acme"\n';

  expect(withThemeLine(text, "nord")).toBe(
    'theme = "nord"\n# ring the bell\nbell = false\n\n# the workspaces\n[workspaces.T1]\nname = "Acme"\n',
  );
});

test("a top-level value over several lines is left whole", () => {
  const text = 'recentDms = [\n  "a",\n  "b",\n]\nbell = false\n';
  const edited = withThemeLine(text, "nord");

  expect(Bun.TOML.parse(edited)).toEqual({
    theme: "nord",
    recentDms: ["a", "b"],
    bell: false,
  });
});

test("with no top-level keys it goes above the first section and the comment on it", () => {
  const text = '# termslack\n\n# workspaces\n[workspaces.T1]\nname = "Acme"\n';

  expect(withThemeLine(text, "nord")).toBe(
    '# termslack\n\ntheme = "nord"\n\n# workspaces\n[workspaces.T1]\nname = "Acme"\n',
  );
});

test("a file without sections gets the line above its keys, or at the end with none", () => {
  expect(withThemeLine("bell = false", "nord")).toBe(
    'theme = "nord"\nbell = false\n',
  );
  expect(withThemeLine("# nothing yet\n", "nord")).toBe(
    '# nothing yet\ntheme = "nord"\n',
  );
});

test("an empty file becomes just the theme line", () => {
  expect(withThemeLine("", "nord")).toBe('theme = "nord"\n');
});

test("the result is valid TOML with the theme set", () => {
  const text = 'defaultWorkspace = "T1"\n\n[workspaces.T1]\nname = "Acme"\n';

  expect(Bun.TOML.parse(withThemeLine(text, "nord"))).toEqual({
    defaultWorkspace: "T1",
    theme: "nord",
    workspaces: { T1: { name: "Acme" } },
  });
});

test("saveThemeChoice edits the config file, creating it when missing", async () => {
  await saveThemeChoice("nord");

  expect(await Bun.file(configFile).text()).toBe('theme = "nord"\n');

  await Bun.write(configFile, "# keep me\n\nbell = false\n");
  await saveThemeChoice("white");

  expect(await Bun.file(configFile).text()).toBe(
    '# keep me\n\ntheme = "white"\nbell = false\n',
  );
  expect((await loadConfig()).theme).toBe("white");
});

test("saveThemeChoice rejects when the file can't be written", async () => {
  await mkdir(`${configFile}/inside`, { recursive: true });

  await expect(saveThemeChoice("nord")).rejects.toThrow();
});
