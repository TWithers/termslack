import { beforeEach, expect, test } from "bun:test";
import {
  deleteSecrets,
  loadSecrets,
  resetSecretsForTests,
  updateSecrets,
  type SecretsBackend,
} from "../src/config/secrets";

function countingBackend(initial: Record<string, string> = {}) {
  const store = { ...initial };
  const calls = { reads: 0, writes: 0, deletes: 0 };
  const backend: SecretsBackend = {
    name: "counting",
    get: async (teamId) => {
      calls.reads += 1;

      return store[teamId] ?? null;
    },
    set: async (teamId, value) => {
      calls.writes += 1;
      store[teamId] = value;
    },
    delete: async (teamId) => {
      calls.deletes += 1;
      delete store[teamId];
    },
  };

  return { backend, calls, store };
}

beforeEach(() => resetSecretsForTests());

test("a startup that changes nothing reads once and never writes", async () => {
  const { backend, calls } = countingBackend({
    T1: JSON.stringify({ userToken: "xoxp-1", appToken: "xapp-1" }),
  });

  resetSecretsForTests(backend);

  await loadSecrets("T1");
  await loadSecrets("T1");
  await updateSecrets("T1", { userToken: "xoxp-1" });
  await loadSecrets("T1");
  await updateSecrets("T1", { appToken: "xapp-1" });

  expect(calls).toEqual({ reads: 1, writes: 0, deletes: 0 });
});

test("a real change reads once and writes once, then repeats are free", async () => {
  const { backend, calls, store } = countingBackend({
    T1: JSON.stringify({ configToken: "old" }),
  });

  resetSecretsForTests(backend);

  await loadSecrets("T1");
  await updateSecrets("T1", { configToken: "new" });
  await updateSecrets("T1", { configToken: "new" });
  await loadSecrets("T1");

  expect(calls).toEqual({ reads: 1, writes: 1, deletes: 0 });
  expect(JSON.parse(store.T1 ?? "")).toEqual({ configToken: "new" });
  expect(await loadSecrets("T1")).toEqual({ configToken: "new" });
});

test("a missing item is cached as empty and removing a key drops it", async () => {
  const { backend, calls, store } = countingBackend();

  resetSecretsForTests(backend);

  expect(await loadSecrets("T1")).toEqual({});
  await updateSecrets("T1", { userToken: undefined });

  expect(calls).toEqual({ reads: 1, writes: 0, deletes: 0 });

  await updateSecrets("T1", { userToken: "xoxp-1", appToken: "xapp-1" });
  const after = await updateSecrets("T1", { userToken: undefined });

  expect(after).toEqual({ appToken: "xapp-1" });
  expect(JSON.parse(store.T1 ?? "")).toEqual({ appToken: "xapp-1" });
  expect(calls).toEqual({ reads: 1, writes: 2, deletes: 0 });
});

test("deleting clears the cache so the next load reads again", async () => {
  const { backend, calls } = countingBackend({
    T1: JSON.stringify({ userToken: "xoxp-1" }),
  });

  resetSecretsForTests(backend);

  await loadSecrets("T1");
  await deleteSecrets("T1");

  expect(await loadSecrets("T1")).toEqual({});
  expect(calls).toEqual({ reads: 2, writes: 0, deletes: 1 });
});
