import { afterEach, expect, test } from "bun:test";
import { loadFixture } from "./support/fixtures";
import { waitFor } from "./support/fakeSlack";
import {
  type SessionHarness,
  startSessionHarness,
} from "./support/sessionHarness";

let harness: SessionHarness;

afterEach(() => harness.stop());

const channel = "C012AB3CD";

/** Counts change notifications and remembers the version each one saw. */
function watch() {
  const seen: number[] = [];
  const unsubscribe = harness.session.subscribeToChanges(() =>
    seen.push(harness.session.version()),
  );

  return { seen, unsubscribe };
}

/** Lets a held request go. */
function gate() {
  let release!: () => void;
  const opened = new Promise<void>((resolve) => (release = resolve));

  return { opened, release };
}

async function start(options: Parameters<typeof startSessionHarness>[0] = {}) {
  harness = await startSessionHarness({
    ...options,
    prepare: async (slack) => {
      slack.respondPaged(
        "conversations.history",
        await loadFixture("conversations-history"),
      );
      slack.respondPaged(
        "conversations.replies",
        await loadFixture("conversations-replies"),
      );
      await options.prepare?.(slack);
    },
  });
}

test("a live event notifies subscribers and changes the version", async () => {
  await start();
  const { seen } = watch();
  const before = harness.session.version();
  const [payload] = await loadFixture("message");

  await harness.sendEvents(payload!);
  await Bun.sleep(20);

  expect(seen.length).toBeGreaterThan(0);
  expect(harness.session.version()).not.toBe(before);
});

test("a history page notifies, and the version has moved by then", async () => {
  await start();
  const { seen } = watch();
  const before = harness.session.version();

  await harness.session.loadHistory(channel);
  await Bun.sleep(0);

  expect(seen.length).toBeGreaterThan(0);
  expect(seen.at(-1)).toBe(harness.session.version());
  expect(harness.session.version()).not.toBe(before);
});

test("a thread's replies notify", async () => {
  await start();
  await harness.session.loadHistory(channel);
  await Bun.sleep(0);
  const { seen } = watch();
  const before = harness.session.version();

  await harness.session.loadThreadReplies(channel, "1512100000.000300");
  await Bun.sleep(0);

  expect(seen.length).toBeGreaterThan(0);
  expect(harness.session.version()).not.toBe(before);
});

test("the background listing of conversations notifies", async () => {
  const listing = gate();

  await start({
    prepare: async (slack) => {
      const pages = await loadFixture("users-conversations-channels");

      slack.respond("users.conversations", async () => {
        await listing.opened;

        return pages[0]!;
      });
    },
  });
  const { seen } = watch();
  const before = harness.session.version();

  listing.release();
  await waitFor(() => harness.session.conversations().length > 0);
  await Bun.sleep(0);

  expect(seen.length).toBeGreaterThan(0);
  expect(harness.session.version()).not.toBe(before);
});

test("the background listing of people notifies once per page, not once per person", async () => {
  const listing = gate();
  const [page] = await loadFixture("users-list");
  const people = Array.from({ length: 200 }, (_, index) => ({
    ...page!.members[0],
    id: `U0BULK${String(index).padStart(4, "0")}`,
  }));

  await start({
    prepare: (slack) =>
      slack.respond("users.list", async () => {
        await listing.opened;

        return { ...page!, members: people, response_metadata: {} };
      }),
  });
  const { seen } = watch();

  listing.release();
  await waitFor(() => harness.session.users().length >= 200);
  await Bun.sleep(20);

  expect(harness.session.users()).toHaveLength(200);
  expect(seen.length).toBeLessThanOrEqual(2);
  expect(seen.length).toBeGreaterThan(0);
});

test("custom emoji loading notifies", async () => {
  const listing = gate();
  const [list] = await loadFixture("emoji-list");

  await start({
    prepare: (slack) =>
      slack.respond("emoji.list", async () => {
        await listing.opened;

        return list!;
      }),
  });
  const { seen } = watch();

  listing.release();
  await waitFor(() => harness.session.customEmoji("bowtie"));
  await Bun.sleep(0);

  expect(seen.length).toBeGreaterThan(0);
});

test("a user group learned from a mention notifies", async () => {
  const [groups] = await loadFixture("usergroups-list");
  const [payload] = await loadFixture("message");
  const groupId = groups!.usergroups[0].id;

  await start({
    prepare: (slack) => slack.respond("usergroups.list", () => groups!),
  });
  const { seen } = watch();

  await harness.sendEvents({
    ...payload!,
    event: {
      ...payload!.event,
      channel,
      text: `ping <!subteam^${groupId}>`,
    },
  });
  await waitFor(() => harness.session.userGroup(groupId));
  await Bun.sleep(0);

  expect(seen.length).toBeGreaterThan(0);
});

test("a name that resolves after the bounded wait notifies late", async () => {
  const lookup = gate();
  const [payload] = await loadFixture("message");
  const [info] = await loadFixture("users-info");

  await start({
    nameWaitMs: 30,
    prepare: (slack) =>
      slack.respond("users.info", async () => {
        await lookup.opened;

        return info!;
      }),
  });

  await harness.sendEvents({
    ...payload!,
    event: { ...payload!.event, channel, user: info!.user.id },
  });
  await Bun.sleep(10);

  expect(harness.session.user(info!.user.id)).toBeUndefined();

  const { seen } = watch();
  const before = harness.session.version();

  lookup.release();
  await waitFor(() => harness.session.user(info!.user.id));
  await Bun.sleep(0);

  expect(seen.length).toBeGreaterThan(0);
  expect(harness.session.version()).not.toBe(before);
});

test("many changes in one tick give one notification", async () => {
  await start();
  const { seen } = watch();

  await harness.session.loadHistory(channel);
  await Bun.sleep(20);

  const pageSize = harness.session.messages(channel).length;

  expect(pageSize).toBeGreaterThan(1);
  expect(seen.length).toBeLessThan(pageSize);
});

test("the version stays the same while nothing changes, and no notification comes", async () => {
  await start();
  await Bun.sleep(30);
  const { seen } = watch();
  const before = harness.session.version();

  await Bun.sleep(50);

  expect(harness.session.version()).toBe(before);
  expect(harness.session.version()).toBe(before);
  expect(seen).toEqual([]);
});

test("an unsubscribed listener hears nothing more", async () => {
  await start();
  const { seen, unsubscribe } = watch();

  unsubscribe();
  await harness.session.loadHistory(channel);
  await Bun.sleep(20);

  expect(seen).toEqual([]);
});

test("session event subscribers still get exactly the events, not change notifications", async () => {
  await start();
  const [payload] = await loadFixture("message");
  const before = harness.events.length;

  await harness.sendEvents(payload!);
  await harness.session.loadHistory(channel);
  await Bun.sleep(20);

  expect(harness.events.slice(before).map((event) => event.kind)).toEqual([
    "message",
  ]);
});
