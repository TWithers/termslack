import { afterEach, expect, test } from "bun:test";
import type { ConversationMemory } from "../src/config/state";
import { loadFixture } from "./support/fixtures";
import {
  type AppHarness,
  keys,
  seedWorkspace,
  startAppHarness,
} from "./support/appHarness";

let app: AppHarness;

afterEach(() => app.stop());

const general = "C012AB3CD";
const random = "C061EG9T2";

/** A memory that keeps its value in a variable and records what it was asked to remember. */
function fakeMemory(initial?: string) {
  const writes: (string | undefined)[] = [];
  let stored = initial;

  const memory: ConversationMemory = {
    recall: async () => stored,
    remember(id) {
      stored = id;
      writes.push(id);
    },
    flush: async () => {},
  };

  return { memory, writes, stored: () => stored };
}

async function start(
  memory: ConversationMemory,
  options: Parameters<typeof startAppHarness>[0] = {},
) {
  const historyPages = await loadFixture("conversations-history");

  app = await startAppHarness({
    ...options,
    conversationMemory: memory,
    prepare: (slack) => {
      slack.respondPaged("conversations.history", historyPages);
      return options.prepare?.(slack);
    },
  });
}

const historyCalls = (channel: string) =>
  app.slack.calls.filter(
    (call) =>
      call.method === "conversations.history" &&
      call.params.channel === channel,
  );

const selectedLine = () =>
  app
    .screen()
    .split("\n")
    .find((l) => l.includes("›"));

/** Holds back the people listing, which the reopening waits for, until released. */
function holdPeopleListing() {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));

  return {
    release,
    prepare: (slack: Parameters<typeof seedWorkspace>[0]) => {
      const seeded = slack.handler("users.list");

      slack.respond("users.list", async (call) => {
        await gate;

        return seeded(call);
      });
    },
  };
}

test("opening a conversation remembers it, once per change", async () => {
  const { memory, writes } = fakeMemory();

  await start(memory);
  await app.waitForScreen("#general");

  await app.press("j");
  await app.press("k");
  expect(writes).toEqual([]);

  await app.press(keys.enter);
  await app.press("j");
  await app.press(keys.enter);

  expect(writes).toEqual([general, random]);
});

test("the remembered conversation opens on start, with history, selection and cleared markers", async () => {
  const { memory } = fakeMemory(random);

  await start(memory);
  await app.waitForScreen("What, you want to smell my shoes better?");

  expect(app.screen()).not.toContain("No conversation open");
  expect(selectedLine()).toContain("#random");
  expect(historyCalls(random)).toHaveLength(1);
  expect(app.session.markers(random)).toEqual({ isUnread: false, mentions: 0 });
});

test("reopening on start doesn't remember it again", async () => {
  const { memory, writes } = fakeMemory(random);

  await start(memory);
  await app.waitForScreen("What, you want to smell my shoes better?");

  expect(writes).toEqual([]);
});

test("the remembered conversation waits for the listing without blocking the UI", async () => {
  const { memory } = fakeMemory(random);
  const gate = holdPeopleListing();

  await start(memory, { prepare: gate.prepare });
  await app.waitForScreen("#general");
  await app.press("j");

  expect(app.screen()).toContain("No conversation open");
  expect(selectedLine()).toContain("#random");

  gate.release();

  await app.waitForScreen("What, you want to smell my shoes better?");
});

test("a remembered conversation that isn't in the listing is ignored and forgotten", async () => {
  const { memory, writes, stored } = fakeMemory("C0GONE0000");

  await start(memory);
  await app.waitForScreen("#general");
  await Bun.sleep(100);

  expect(app.screen()).toContain("No conversation open");
  expect(writes).toEqual([undefined]);
  expect(stored()).toBeUndefined();
});

test("a remembered conversation that was archived is ignored and forgotten", async () => {
  const { memory, stored } = fakeMemory(random);
  const [channels] = await loadFixture("users-conversations-channels");
  const [directs] = await loadFixture("users-conversations-dms");

  await start(memory, {
    prepare: (slack) =>
      slack.respondPaged("users.conversations", [
        {
          ...channels!,
          channels: channels!.channels.map((c: any) =>
            c.id === random ? { ...c, is_archived: true } : c,
          ),
        },
        directs!,
      ]),
  });
  await app.waitForScreen("#general");
  await Bun.sleep(100);

  expect(app.screen()).toContain("No conversation open");
  expect(historyCalls(random)).toHaveLength(0);
  expect(stored()).toBeUndefined();
});

test("a failed listing doesn't forget the remembered conversation", async () => {
  const { memory, stored } = fakeMemory(random);

  await start(memory, {
    listingRetryDelaysMs: [],
    prepare: (slack) =>
      slack.respond("users.conversations", () => ({
        ok: false,
        error: "ratelimited",
      })),
  });
  await app.session.findConversation("x", { waitMs: 500 });
  await Bun.sleep(100);

  expect(app.screen()).toContain("No conversation open");
  expect(stored()).toBe(random);
});

test("opening something yourself before it's confirmed wins over the remembered one", async () => {
  const { memory, writes } = fakeMemory(random);
  const gate = holdPeopleListing();

  await start(memory, { prepare: gate.prepare });
  await app.waitForScreen("#general");
  await app.press(keys.enter);
  await app.waitForScreen("Deploy finished");
  expect(writes).toEqual([general]);

  gate.release();
  await Bun.sleep(100);

  expect(selectedLine()).toContain("#general");
  expect(historyCalls(random)).toHaveLength(0);
  expect(writes).toEqual([general]);
});
