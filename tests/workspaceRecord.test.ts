import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { rm } from "node:fs/promises";
import { configFile, stateFile } from "../src/config/paths";
import {
  loadDefaultWorkspaceId,
  loadWorkspace,
  recordWorkspace,
} from "../src/config/workspace";

const reset = () =>
  Promise.all([
    rm(configFile, { force: true }),
    rm(stateFile, { force: true }),
  ]);

beforeEach(reset);
afterEach(reset);

const exists = (path: string) => Bun.file(path).exists();

test("recording on a fresh machine writes the state file and creates no config.toml", async () => {
  expect(await loadDefaultWorkspaceId()).toBeUndefined();

  await recordWorkspace("T1", { appId: "A1", teamName: "Acme" });

  expect(await exists(configFile)).toBe(false);
  expect(await loadDefaultWorkspaceId()).toBe("T1");
  expect(await loadWorkspace("T1")).toEqual({
    teamId: "T1",
    appId: "A1",
    teamName: "Acme",
  });
});

test("an older config.toml is read as a fallback, field by field, and state wins", async () => {
  await Bun.write(
    configFile,
    '[workspaces.T1]\nteamId = "T1"\nappId = "OLD"\nuserName = "tim"\nrecentDms = 7\n',
  );

  expect(await loadDefaultWorkspaceId()).toBeUndefined();
  expect(await loadWorkspace("T1")).toMatchObject({
    appId: "OLD",
    userName: "tim",
    recentDms: 7,
  });

  await recordWorkspace("T1", { appId: "A1" });

  expect(await loadWorkspace("T1")).toMatchObject({
    appId: "A1",
    userName: "tim",
    recentDms: 7,
  });
});

test("a defaultWorkspace in config.toml wins over the recorded one, and recording does not replace it", async () => {
  const text = 'defaultWorkspace = "T2" # mine\n';

  await Bun.write(configFile, text);
  await recordWorkspace("T1", { appId: "A1" });

  expect(await loadDefaultWorkspaceId()).toBe("T2");
  expect(await Bun.file(configFile).text()).toBe(text);
});

test("the first recorded workspace stays the default", async () => {
  await recordWorkspace("T1");
  await recordWorkspace("T2");

  expect(await loadDefaultWorkspaceId()).toBe("T1");
});

test("recorded values never come from, or go into, recentDms and sections", async () => {
  await recordWorkspace("T1", { appId: "A1" });

  expect(await loadWorkspace("T1")).not.toHaveProperty("recentDms");
  expect(await loadWorkspace("T1")).not.toHaveProperty("sections");
});

test("recording a workspace and its default is one write of the state file", async () => {
  const stringify = spyOn(Bun.TOML, "stringify");

  try {
    await recordWorkspace("T1", { appId: "A1" });

    expect(stringify).toHaveBeenCalledTimes(1);
  } finally {
    stringify.mockRestore();
  }
});
