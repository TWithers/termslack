import { afterEach, beforeEach, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import {
  kittyKeyboardEnabled,
  loadConfig,
  notificationLevel,
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

test("notifications is a top-level setting that defaults to desktop", async () => {
  expect(notificationLevel(await loadConfig())).toEqual({ level: "desktop" });

  for (const level of ["desktop", "bell", "off"] as const) {
    await Bun.write(configFile, `notifications = "${level}"\n`);

    expect(notificationLevel(await loadConfig())).toEqual({ level });
  }
});

test("the old bell and desktopNotifications settings still pick the level", () => {
  expect(notificationLevel({ bell: false })).toEqual({ level: "off" });
  expect(notificationLevel({ desktopNotifications: false })).toEqual({
    level: "bell",
  });
  expect(
    notificationLevel({ bell: false, desktopNotifications: false }),
  ).toEqual({ level: "off" });

  for (const configured of ["false", 0, null, true]) {
    expect(
      notificationLevel({ bell: configured, desktopNotifications: configured }),
    ).toEqual({ level: "desktop" });
  }
});

test("an explicit notifications wins over the old settings", () => {
  expect(
    notificationLevel({
      notifications: "desktop",
      bell: false,
      desktopNotifications: false,
    }),
  ).toEqual({ level: "desktop" });
  expect(notificationLevel({ notifications: "bell", bell: false })).toEqual({
    level: "bell",
  });
});

test("an unknown notifications value means desktop and is reported", () => {
  expect(notificationLevel({ notifications: "loud", bell: false })).toEqual({
    level: "desktop",
    unknown: "loud",
  });
  expect(notificationLevel({ notifications: true })).toEqual({
    level: "desktop",
    unknown: "true",
  });
});
