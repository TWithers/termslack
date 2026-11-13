import { afterEach, beforeEach, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { stateFile } from "../src/config/paths";
import {
  loadWorkspaceState,
  updateWorkspaceState,
  workspaceCollapseMemory,
  workspaceConversationMemory,
  workspaceDmActivityCache,
  workspaceHideMutedMemory,
  workspaceMuteMemory,
} from "../src/config/state";

beforeEach(() => rm(stateFile, { force: true }));
afterEach(() => rm(stateFile, { force: true }));

test("state is kept per workspace and merged, not replaced", async () => {
  await updateWorkspaceState("T1", { lastConversation: "C1" });
  await updateWorkspaceState("T2", { lastConversation: "C2" });

  expect(await loadWorkspaceState("T1")).toEqual({ lastConversation: "C1" });
  expect(await loadWorkspaceState("T2")).toEqual({ lastConversation: "C2" });
  expect(await loadWorkspaceState("T3")).toEqual({});
});

test("setting a key to undefined removes it", async () => {
  await updateWorkspaceState("T1", { lastConversation: "C1" });
  await updateWorkspaceState("T1", { lastConversation: undefined });

  expect(await loadWorkspaceState("T1")).toEqual({});
});

test("the state file lives under the isolated XDG_STATE_HOME", () => {
  expect(stateFile.startsWith(process.env.XDG_STATE_HOME!)).toBe(true);
});

test("conversation memory recalls what an earlier run remembered", async () => {
  const first = workspaceConversationMemory("T1", { debounceMs: 5 });

  first.remember("C1");
  await first.flush();

  expect(await workspaceConversationMemory("T1").recall()).toBe("C1");
  expect(await workspaceConversationMemory("T2").recall()).toBeUndefined();
});

test("quick changes are written once, with the last value", async () => {
  const memory = workspaceConversationMemory("T1", { debounceMs: 30 });

  memory.remember("C1");
  memory.remember("C2");
  memory.remember("C3");

  expect(await Bun.file(stateFile).exists()).toBe(false);

  await Bun.sleep(80);

  expect(await loadWorkspaceState("T1")).toEqual({ lastConversation: "C3" });
});

test("remembering what is already stored doesn't rewrite the file", async () => {
  const memory = workspaceConversationMemory("T1", { debounceMs: 5 });

  memory.remember("C1");
  await memory.flush();

  const before = Bun.file(stateFile).lastModified;

  await Bun.sleep(20);
  memory.remember("C1");
  await memory.flush();

  expect(Bun.file(stateFile).lastModified).toBe(before);
});

test("remembering nothing forgets the conversation", async () => {
  const memory = workspaceConversationMemory("T1", { debounceMs: 5 });

  memory.remember("C1");
  await memory.flush();
  memory.remember(undefined);
  await memory.flush();

  expect(await workspaceConversationMemory("T1").recall()).toBeUndefined();
});

test("DM activity round-trips through the state file and keeps other state", async () => {
  await updateWorkspaceState("T1", { lastConversation: "C1" });

  const cache = workspaceDmActivityCache("T1", { debounceMs: 5 });
  const activity = {
    latest: { D1: "1700000000.000100", D2: "1700000500.000200" },
    hidden: ["D3"],
    lastRun: "2026-11-04",
  };

  expect(await cache.load()).toBeUndefined();

  cache.save(activity);
  await cache.flush();

  expect(await workspaceDmActivityCache("T1").load()).toEqual(activity);
  expect(await workspaceDmActivityCache("T2").load()).toBeUndefined();
  expect((await loadWorkspaceState("T1")).lastConversation).toBe("C1");
});

test("quick DM activity changes are written once, with the last state", async () => {
  const cache = workspaceDmActivityCache("T1", { debounceMs: 30 });

  cache.save({ latest: { D1: "1.0" }, hidden: [] });
  cache.save({ latest: { D1: "2.0" }, hidden: [] });
  cache.save({ latest: { D1: "3.0" }, hidden: [] });

  expect(await Bun.file(stateFile).exists()).toBe(false);

  await Bun.sleep(80);

  expect((await cache.load())?.latest).toEqual({ D1: "3.0" });
});

test("collapse memory recalls what an earlier run remembered, and forgets when nothing is collapsed", async () => {
  const first = workspaceCollapseMemory("T1", { debounceMs: 5 });

  expect(await first.recall()).toEqual([]);

  first.remember(["channels", "section:Work"]);
  await first.flush();

  expect(await workspaceCollapseMemory("T1").recall()).toEqual([
    "channels",
    "section:Work",
  ]);
  expect(await workspaceCollapseMemory("T2").recall()).toEqual([]);

  first.remember([]);
  await first.flush();

  expect(await loadWorkspaceState("T1")).toEqual({});
});

test("mute memory recalls the channels an earlier run muted, per workspace, and forgets when none are", async () => {
  const first = workspaceMuteMemory("T1", { debounceMs: 5 });

  expect(await first.recall()).toEqual([]);

  first.remember(["C1", "C2"]);
  await first.flush();

  expect(await workspaceMuteMemory("T1").recall()).toEqual(["C1", "C2"]);
  expect(await workspaceMuteMemory("T2").recall()).toEqual([]);

  first.remember([]);
  await first.flush();

  expect(await loadWorkspaceState("T1")).toEqual({});
});

test("hide-muted memory recalls the choice, and forgets it when muted channels show again", async () => {
  const first = workspaceHideMutedMemory("T1", { debounceMs: 5 });

  expect(await first.recall()).toBe(false);

  first.remember(true);
  await first.flush();

  expect(await workspaceHideMutedMemory("T1").recall()).toBe(true);
  expect(await workspaceHideMutedMemory("T2").recall()).toBe(false);

  first.remember(false);
  await first.flush();

  expect(await workspaceHideMutedMemory("T1").recall()).toBe(false);
  expect(await loadWorkspaceState("T1")).not.toHaveProperty(
    "hideMutedChannels",
  );
});
