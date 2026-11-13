import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import type { SectionConfig } from "../src/config/config";
import { configFile, stateFile } from "../src/config/paths";
import {
  loadWorkspaceState,
  workspaceCollapseMemory,
  workspaceSectionsMemory,
} from "../src/config/state";
import { sectionsNote } from "../src/session/sections";
import { type AppHarness, startAppHarness } from "./support/appHarness";
import { waitFor } from "./support/fakeSlack";

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

const work: SectionConfig = { name: "Work", channels: ["#random"] };

const commentedConfig = `# my settings
defaultWorkspace = "T1" # mine

[workspaces.T1]
teamId = "T1"

# sections I keep by hand
[[workspaces.T1.sections]]
name = "Work"
channels = ["#random", "ghost"]
`;

async function start(
  options: Parameters<typeof startAppHarness>[0] = {},
  { memory = true }: { memory?: boolean } = {},
) {
  app = await startAppHarness({
    sectionsMemory: memory
      ? workspaceSectionsMemory(teamId, { debounceMs: 0 })
      : undefined,
    columns: 100,
    ...options,
  });
  await app.waitForScreen("@Peter Venkman");
}

const sidebarNames = () =>
  app
    .screen()
    .split("\n")
    .map((line) => line.slice(0, 32).slice(3).trim())
    .filter(Boolean);

/** Waits until the sidebar's first rows read `expected`. */
const waitForSidebar = (expected: string[]) =>
  waitFor(() => {
    const rows = sidebarNames().slice(0, expected.length);

    return rows.join("|") === expected.join("|") || undefined;
  });

const kept = async () => (await loadWorkspaceState(teamId)).sections;

describe("before any change", () => {
  test("sections come from config.toml as today and nothing is written", async () => {
    await start({ sections: [work] });

    expect(app.session.sections()).toEqual([work]);
    expect(app.session.sectionsKeptByTermslack()).toBe(false);
    expect(app.session.sectionsNote()).toBeUndefined();
    await waitForSidebar(["Work", "#random", "Channels", "#general"]);

    await app.session.stop();
    expect(await Bun.file(stateFile).exists()).toBe(false);
  });

  test("a change that changes nothing does not take the sections over", async () => {
    await start({ sections: [work] });

    app.session.removeFromSections(general);
    app.session.moveToSection(random, "Work");

    expect(app.session.sectionsKeptByTermslack()).toBe(false);
    expect(app.session.sectionsNote()).toBeUndefined();
  });
});

describe("the first change", () => {
  test("copies the shown sections by channel ID, dropping unknown names, and leaves a commented config.toml byte for byte", async () => {
    await Bun.write(configFile, commentedConfig);
    await start({
      sections: [{ name: "Work", channels: ["#random", "ghost", "C0MISSING"] }],
    });

    app.session.moveToSection(general, "Work");
    await app.session.stop();

    expect(await kept()).toEqual([
      { name: "Work", channels: [random, general] },
    ]);
    expect(await Bun.file(configFile).text()).toBe(commentedConfig);
  });

  test("a channel listed in two sections is copied into the first only; IDs and #names both resolve", async () => {
    await start({
      sections: [
        { name: "One", channels: [general.toLowerCase()] },
        { name: "Two", channels: ["#general", "random"] },
      ],
    });

    app.session.addSection("Three");
    await app.session.stop();

    expect(await kept()).toEqual([
      { name: "One", channels: [general] },
      { name: "Two", channels: [random] },
      { name: "Three", channels: [] },
    ]);
  });

  test("shows the note once, and config.toml's sections are ignored from then on", async () => {
    await start({ sections: [work] });

    app.session.moveToSection(general, "Work");

    await app.waitForScreen(sectionsNote);
    expect(app.session.sectionsKeptByTermslack()).toBe(true);
    await waitForSidebar(["Work", "#general", "#random", "Channels"]);

    await app.session.stop();
    await app.stop();

    await start({ sections: [{ name: "Old", channels: ["#general"] }] });

    expect(app.session.sections()).toEqual([
      { name: "Work", channels: [random, general] },
    ]);
    expect(app.session.sectionsNote()).toBeUndefined();
    expect(app.screen()).not.toContain("config.toml");
    expect(sidebarNames()).not.toContain("Old");
  });

  test("a second change shows no new note", async () => {
    await start({ sections: [work] });

    app.session.moveToSection(general, "Work");
    await app.waitForScreen(sectionsNote);

    expect(app.session.sectionsNote()).toBe(sectionsNote);
  });

  test("a repeated name differing only in case or spacing is refused", async () => {
    await start();

    app.session.addSection("Work");

    expect(app.session.addSection("  work ")).toEqual({
      ok: false,
      reason: "There is already a section named work",
    });
    expect(app.session.sections().map(({ name }) => name)).toEqual(["Work"]);
  });

  test("no note when config.toml had no sections to ignore", async () => {
    await start();

    app.session.addSection("Work");

    expect(app.session.sectionsKeptByTermslack()).toBe(true);
    expect(app.session.sectionsNote()).toBeUndefined();
  });

  test("ids of channels termslack no longer lists don't raise the not-found warning", async () => {
    await start({ sections: [work] });

    app.session.moveToSection("C0GONE", "Work");
    await waitFor(() => app.session.sectionsKeptByTermslack());

    expect(app.screen()).not.toContain("not found in sections");
  });

  test("collapsed sections stay collapsed across the copy", async () => {
    await workspaceCollapseMemory(teamId, { debounceMs: 0 }).flush();
    await Bun.write(
      stateFile,
      `[workspaces.${teamId}]\ncollapsedSections = ["section:Work"]\n`,
    );
    await start({
      sections: [work],
      collapseMemory: workspaceCollapseMemory(teamId, { debounceMs: 0 }),
    });
    await waitFor(() => !app.screen().includes("#random"));

    app.session.moveToSection(general, "Work");
    await app.session.stop();

    const state = await loadWorkspaceState(teamId);

    expect(state.collapsedSections).toEqual(["section:Work"]);
    expect(state.sections?.[0]?.name).toBe("Work");
    expect(app.screen()).not.toContain("#random");
  });
});

describe("operations", () => {
  test("moving a channel puts it in the section and takes it out of any other", async () => {
    await start({
      sections: [
        { name: "One", channels: ["#random"] },
        { name: "Two", channels: [] },
      ],
    });

    expect(app.session.moveToSection(random, "Two")).toEqual({ ok: true });
    await waitForSidebar(["One", "Two", "#random", "Channels"]);
    expect(app.session.sections()).toEqual([
      { name: "One", channels: [] },
      { name: "Two", channels: [random] },
    ]);
  });

  test("taking a channel out of every section sends it back to Channels", async () => {
    await start({ sections: [work] });

    app.session.removeFromSections(random);
    await waitForSidebar(["Work", "Channels", "#general", "#random"]);
    expect(app.session.sections()).toEqual([{ name: "Work", channels: [] }]);
  });

  test("a new section goes after the last one and stays while empty", async () => {
    await start({ sections: [work] });

    expect(app.session.addSection("  Fun  ")).toEqual({ ok: true });
    await waitForSidebar(["Work", "#random", "Fun", "Channels"]);
  });

  test("an empty or repeated name is refused and changes nothing", async () => {
    await start({ sections: [work] });

    expect(app.session.addSection("   ")).toMatchObject({ ok: false });
    expect(app.session.addSection("Work")).toMatchObject({
      ok: false,
      reason: expect.stringContaining("Work"),
    });
    expect(app.session.moveToSection(general, "Nope")).toMatchObject({
      ok: false,
    });
    expect(app.session.sectionsKeptByTermslack()).toBe(false);
  });

  test("changes are kept in the state file and survive a restart", async () => {
    await start();

    app.session.addSection("Work");
    app.session.moveToSection(general, "Work");
    await app.session.stop();
    await app.stop();

    await start();

    expect(app.session.sections()).toEqual([
      { name: "Work", channels: [general] },
    ]);
    await waitForSidebar(["Work", "#general", "Channels"]);
  });
});
