import { afterEach, beforeEach, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import type { SectionConfig } from "../src/config/config";
import { configFile, stateFile } from "../src/config/paths";
import {
  loadWorkspaceState,
  workspaceSectionsMemory,
} from "../src/config/state";
import { sectionsNote } from "../src/session/sections";
import { type AppHarness, keys, startAppHarness } from "./support/appHarness";
import { sidebarRows as readSidebarRows } from "./support/panes";
import { waitFor } from "./support/fakeSlack";
import { findPopup } from "./support/popup";

let app: AppHarness;

const reset = () =>
  Promise.all([
    rm(configFile, { force: true }),
    rm(stateFile, { force: true }),
  ]);

beforeEach(reset);
afterEach(async () => {
  await app.stop();
  await reset();
});

const general = "C012AB3CD";
const random = "C061EG9T2";
const teamId = "T1";
const sidebarWidth = 32;

const sections: SectionConfig[] = [
  { name: "Work", channels: ["#random"] },
  { name: "Play", channels: [] },
];

async function start(configured: SectionConfig[] = sections) {
  app = await startAppHarness({
    sections: configured,
    sectionsMemory: workspaceSectionsMemory(teamId, { debounceMs: 0 }),
    columns: 100,
  });
  await app.waitForScreen("@Peter Venkman");
}

const statusLineText = () => app.screen().trimEnd().split("\n").at(-1)!;
const bottomLine = () => app.screen().trimEnd().split("\n").at(-2)!;
const sectionPopup = () => findPopup(app.screen(), "New section");
const promptText = () => sectionPopup()?.rows.join("\n") ?? "";
const sidebarRows = () => readSidebarRows(app.screen(), sidebarWidth);
const sidebarNames = () =>
  sidebarRows()
    .map((row) => row.slice(3).trim())
    .filter(Boolean);
const selectedRow = () =>
  sidebarRows()
    .find((row) => row.startsWith("›"))
    ?.replace(/^›\s*(▾ |▸ )?/, "")
    .trim();
const waitForSidebar = (expected: string[]) =>
  waitFor(
    () =>
      sidebarNames().slice(0, expected.length).join("|") ===
        expected.join("|") || undefined,
  );
/** The second list, found by its title; the sidebar is blanked out first. */
const list = () =>
  findPopup(
    app
      .screen()
      .split("\n")
      .map((line) => " ".repeat(sidebarWidth) + line.slice(sidebarWidth))
      .join("\n"),
    "Move to section",
  );
const kept = async () => (await loadWorkspaceState(teamId)).sections;

async function select(name: string) {
  while (selectedRow() !== name) {
    await app.press("j");
  }
}

async function openList(channel: string) {
  await select(channel);
  await app.press("m");
  await app.press("s");
}

test("Move to section lists the sections in order with the current one marked, Channels and New section", async () => {
  await start();
  await waitForSidebar(["Work", "#random", "Play", "Channels", "#general"]);

  await openList("#random");

  const rows = list()!.rows.map((row) => row.slice(1).trimEnd());

  expect(rows).toEqual([
    "› 1 ✓ Work",
    "  2   Play",
    "  c   Channels (no section)",
    "  n   New section…",
  ]);
});

test("under Channels, that entry is the marked one", async () => {
  await start();

  await openList("#general");

  expect(list()!.rows.join("\n")).toContain("c ✓ Channels (no section)");
});

test("choosing a section moves the channel in at once, closes the popup and keeps it selected", async () => {
  await start();

  await openList("#general");
  await app.press("2");

  expect(list()).toBeUndefined();
  await waitForSidebar(["Work", "#random", "Play", "#general", "Channels"]);
  expect(selectedRow()).toBe("#general");
  expect(app.session.sections()).toEqual([
    { name: "Work", channels: [random] },
    { name: "Play", channels: [general] },
  ]);

  await app.press("j");
  expect(selectedRow()).toBe("Channels");
});

test("moving between sections takes it out of the old one; Enter chooses the highlighted row", async () => {
  await start();

  await openList("#random");
  await app.press("j");
  await app.press(keys.enter);

  await waitForSidebar(["Work", "Play", "#random", "Channels", "#general"]);
  expect(selectedRow()).toBe("#random");
});

test("choosing Channels takes the channel out of its section, and it is kept across a restart", async () => {
  await start();

  await openList("#random");
  await app.press("c");

  await waitForSidebar(["Work", "Play", "Channels", "#general", "#random"]);
  expect(selectedRow()).toBe("#random");

  await app.session.stop();
  await app.stop();
  await start([{ name: "Ignored", channels: ["#general"] }]);

  expect(await kept()).toEqual([
    { name: "Work", channels: [] },
    { name: "Play", channels: [] },
  ]);
  await waitForSidebar(["Work", "Play", "Channels", "#general", "#random"]);
});

test("Esc in the list goes back to the menu, and Esc again closes it", async () => {
  await start();

  await openList("#general");
  await app.press(keys.escape);

  expect(list()).toBeUndefined();
  expect(app.screen()).toContain("Move to section…");

  await app.press(keys.escape);

  expect(app.screen()).not.toContain("Move to section…");
  expect(app.session.sectionsKeptByTermslack()).toBe(false);
});

test("a click on a row of the list chooses it", async () => {
  await start();

  await openList("#general");

  const popup = list()!;

  await app.click(popup.left + 5, popup.top + 2);

  await waitForSidebar(["Work", "#random", "Play", "#general", "Channels"]);
});

test("New section asks for a name; Enter adds it after the others with the channel in it, kept across a restart", async () => {
  await start();

  await openList("#general");
  await app.press("n");

  expect(list()).toBeUndefined();
  expect(sectionPopup()).toBeDefined();
  expect(sectionPopup()!.bottomBorder).toContain("Enter create");
  expect(sectionPopup()!.bottomBorder).toContain("Esc cancel");
  expect(bottomLine()).not.toContain("New section");
  expect(statusLineText()).not.toContain("Enter create");

  await app.press("Home Office");
  await app.press(keys.enter);

  expect(sectionPopup()).toBeUndefined();
  await waitForSidebar([
    "Work",
    "#random",
    "Play",
    "Home Office",
    "#general",
    "Channels",
  ]);
  expect(selectedRow()).toBe("#general");

  await app.session.stop();
  await app.stop();
  await start([]);

  expect(await kept()).toEqual([
    { name: "Work", channels: [random] },
    { name: "Play", channels: [] },
    { name: "Home Office", channels: [general] },
  ]);
  await waitForSidebar([
    "Work",
    "#random",
    "Play",
    "Home Office",
    "#general",
    "Channels",
  ]);
});

test("an empty name and a repeated one are refused with a reason, and the prompt stays open", async () => {
  await start();

  await openList("#general");
  await app.press("n");
  await app.press(keys.enter);

  expect(promptText()).toContain("A section needs a name");
  expect(app.session.sectionsKeptByTermslack()).toBe(false);

  await app.press("Play");
  expect(promptText()).not.toContain("needs a name");

  await app.press(keys.enter);

  expect(promptText()).toContain("There is already a section named Play");
  expect(promptText()).toContain("> Play");

  await app.press("x");
  await app.press(keys.enter);

  await waitForSidebar(["Work", "#random", "Play", "Playx", "#general"]);
});

test("Esc cancels the name prompt and closes everything, changing nothing", async () => {
  await start();

  await openList("#general");
  await app.press("n");
  await app.press("abc");
  await app.press(keys.escape);

  expect(sectionPopup()).toBeUndefined();
  expect(app.screen()).not.toContain("Move to section");
  expect(app.session.sectionsKeptByTermslack()).toBe(false);

  await app.press("j");
  expect(selectedRow()).not.toBe("#general");
});

test("the prompt takes every key, such as q, and Ctrl+C still quits", async () => {
  await start();

  await openList("#general");
  await app.press("n");
  await app.press("q");

  expect(promptText()).toContain("> q");
});

test("the first change from the menu shows the one-time note", async () => {
  await start();

  await openList("#general");
  await app.press("2");

  await app.waitForScreen("Sections are now kept by termslack");
  expect(app.session.sectionsNote()).toBe(sectionsNote);
});

test("the menu lists Move to section with its letter", async () => {
  await start();

  await app.press("m");

  expect(app.screen()).toContain("s Move to section…");
});

test("a click outside the name popup cancels it, changing nothing", async () => {
  await start();

  await openList("#general");
  await app.press("n");
  await app.press("abc");
  await app.click(0, 0);

  await waitFor(() => sectionPopup() === undefined);
  expect(app.session.sectionsKeptByTermslack()).toBe(false);
});

test("a click inside the name popup leaves it open", async () => {
  await start();

  await openList("#general");
  await app.press("n");
  await app.press("abc");

  const { left, top } = sectionPopup()!;

  await app.click(left + 3, top + 1);

  expect(promptText()).toContain("> abc");
});
