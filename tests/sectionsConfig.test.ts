import { afterEach, beforeEach, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import {
  bellEnabled,
  kittyKeyboardEnabled,
  loadConfig,
  parseSections,
} from "../src/config/config";
import { configFile } from "../src/config/paths";
import { loadWorkspace, recordWorkspace } from "../src/config/workspace";

beforeEach(() => rm(configFile, { force: true }));
afterEach(() => rm(configFile, { force: true }));

const handEdited = `
[workspaces.T1]
teamId = "T1"
recentDms = 10

[[workspaces.T1.sections]]
name = "Work"
channels = ["#deploys", "eng", "C07MZ2P4HJ5"]

[[workspaces.T1.sections]]
name = "Fun"
channels = ["random"]
`;

const expected = [
  { name: "Work", channels: ["#deploys", "eng", "C07MZ2P4HJ5"] },
  { name: "Fun", channels: ["random"] },
];

test("sections survive recording a workspace's setup values unchanged", async () => {
  await Bun.write(configFile, handEdited);

  expect(parseSections((await loadConfig()).workspaces.T1?.sections)).toEqual(
    expected,
  );

  await recordWorkspace("T1", { manifestHash: "abc" });

  const reloaded = await loadWorkspace("T1");

  expect(await Bun.file(configFile).text()).toBe(handEdited);
  expect(parseSections(reloaded.sections)).toEqual(expected);
  expect(reloaded.manifestHash).toBe("abc");
  expect(reloaded.recentDms).toBe(10);
});

test("malformed sections are ignored and the rest kept", () => {
  expect(parseSections("nope")).toEqual([]);
  expect(parseSections(undefined)).toEqual([]);
  expect(
    parseSections([
      "text",
      null,
      { channels: ["a"] },
      { name: "  ", channels: ["a"] },
      { name: "NoChannels" },
      { name: 3, channels: [] },
      { name: " Work ", channels: ["a", 4, "", " #b "] },
      { name: "Work", channels: ["dup"] },
      { name: "Empty", channels: [] },
    ]),
  ).toEqual([
    { name: "Work", channels: ["a", "#b"] },
    { name: "Empty", channels: [] },
  ]);
});

test("kittyKeyboard is a top-level setting that is off unless it is exactly true", async () => {
  expect(kittyKeyboardEnabled((await loadConfig()).kittyKeyboard)).toBe(false);

  await Bun.write(configFile, "kittyKeyboard = true\n");

  expect(kittyKeyboardEnabled((await loadConfig()).kittyKeyboard)).toBe(true);

  expect(kittyKeyboardEnabled((await loadConfig()).kittyKeyboard)).toBe(true);

  for (const configured of ["true", 1, null, undefined, false]) {
    expect(kittyKeyboardEnabled(configured)).toBe(false);
  }
});

test("bell is a top-level setting that is on unless it is exactly false", async () => {
  expect(bellEnabled((await loadConfig()).bell)).toBe(true);

  await Bun.write(configFile, "bell = false\n");

  expect(bellEnabled((await loadConfig()).bell)).toBe(false);

  expect(bellEnabled((await loadConfig()).bell)).toBe(false);

  for (const configured of ["false", 0, null, undefined, true]) {
    expect(bellEnabled(configured)).toBe(true);
  }
});
