import { afterEach, describe, expect, test } from "bun:test";
import { recentDmLimit } from "../src/config/config";
import { loadPayload } from "./support/fixtures";
import { waitFor } from "./support/fakeSlack";
import { resolveSelection } from "../src/ui/app/sidebarEntries";
import { type AppHarness, keys, startAppHarness } from "./support/appHarness";

let app: AppHarness;

afterEach(() => app.stop());

const peter = "D0C0F7S8Y";
const other = "U222222222";

/** Twelve extra DMs, `D1001` newest to `D1012` oldest, all newer than the three in the fixtures. */
const extraIds = Array.from(
  { length: 12 },
  (_, i) => `D10${String(i + 1).padStart(2, "0")}`,
);

async function start(options: Parameters<typeof startAppHarness>[0] = {}) {
  app = await startAppHarness({
    rows: 60,
    ...options,
    prepare: (slack) => {
      const handler = slack.handler("users.conversations");

      slack.respond("users.conversations", async (call) => {
        const page = (await handler(call)) as { channels?: any[] };

        if (call.params.cursor || !page.channels) {
          return page;
        }

        return {
          ...page,
          channels: [
            ...page.channels,
            ...extraIds.map((id, i) => ({
              id,
              created: 1500000000,
              is_im: true,
              user: `U90000${String(i + 1).padStart(2, "0")}`,
              updated: 4_000_000_000_000 - i * 1000,
            })),
          ],
        };
      });
      options.prepare?.(slack);
    },
  });
  await waitFor(
    () => app.session.conversations().length === 17 && shownDms().length > 0,
  );
}

const sidebarLines = (): string[] =>
  app
    .screen()
    .split("\n")
    .map((line) => line.slice(0, 32).trimEnd());

const dmHeading = () =>
  sidebarLines()
    .map((line) => line.slice(3))
    .find((line) => line.startsWith("Direct messages"));

/** The DM rows on screen, as their raw IDs (unresolved people show the user ID). */
const shownDms = () => {
  const lines = sidebarLines();
  const from = lines.findIndex((line) =>
    line.slice(3).startsWith("Direct messages"),
  );

  return lines
    .slice(from + 1)
    .map((line) => line.slice(3).trim())
    .filter((line) => line.startsWith("@"));
};

const rowFor = (label: string) =>
  sidebarLines().find((line) => line.includes(label));

async function say(channel: string, ts: string) {
  const payload = await loadPayload("message");

  await app.sendEvents({
    ...payload,
    event: {
      ...payload.event,
      channel,
      channel_type: "im",
      user: other,
      ts,
    },
  });
}

describe("the recent DM list", () => {
  test("shows the 10 most recent DMs by default, with the hidden count in the heading", async () => {
    await start();

    expect(shownDms()).toHaveLength(10);
    expect(dmHeading()).toBe("Direct messages · 10 of 15");
    expect(app.screen()).not.toContain("Peter Venkman");
  });

  test("a configured limit changes how many are shown", async () => {
    await start({ recentDms: 4 });

    expect(shownDms()).toHaveLength(4);
    expect(dmHeading()).toBe("Direct messages · 4 of 15");
  });

  test("a DM with unread messages is shown even when it is old", async () => {
    await start();
    await say(peter, "1800000000.000100");

    await app.waitForScreen("Peter Venkman");

    expect(shownDms()).toHaveLength(11);
    expect(dmHeading()).toBe("Direct messages · 11 of 15");
  });

  test("the open conversation stays listed after it falls out of the recent window", async () => {
    await start();
    await app.press("a");
    await app.waitForScreen("Peter Venkman");

    const index = sidebarLines().findIndex((line) =>
      line.includes("Peter Venkman"),
    );
    const top = sidebarLines().findIndex((line) => line.includes("Channels"));

    for (let i = 0; i < index - top; i += 1) {
      await app.press(keys.down);
    }

    await app.press(keys.enter);
    await app.press("a");

    expect(dmHeading()).toBe("Direct messages · 11 of 15");
    expect(rowFor("Peter Venkman")).toContain("▌");
  });

  test("a toggles between recent and all DMs", async () => {
    await start();
    await app.press("a");

    expect(dmHeading()).toBe("Direct messages · all 15");
    expect(shownDms()).toHaveLength(15);

    await app.press("a");

    expect(dmHeading()).toBe("Direct messages · 10 of 15");
    expect(shownDms()).toHaveLength(10);
  });

  test("a short list says nothing about hidden DMs", async () => {
    await start({ recentDms: 50 });

    expect(dmHeading()).toBe("Direct messages");
  });
});

describe("selection as the list changes", () => {
  const selectedRow = () => sidebarLines().find((line) => line.startsWith("›"));

  test("a selected DM that drops out of the window is replaced by its neighbour", async () => {
    await start({ recentDms: 3 });
    await app.press("a");

    for (let i = 0; i < 6; i += 1) {
      await app.press(keys.down);
    }

    expect(selectedRow()).toContain("@U9000004");

    await app.press("a");

    expect(selectedRow()).toContain("@U9000003");
  });

  test("new activity bumping a hidden DM into view does not move the selection", async () => {
    await start();
    await app.press(keys.down);

    const before = selectedRow();

    await say(peter, "1800000000.000100");
    await app.waitForScreen("Peter Venkman");

    expect(selectedRow()).toBe(before);
  });
});

describe("the recentDms setting", () => {
  test("falls back to 10 unless it is a positive whole number", () => {
    expect(recentDmLimit(25)).toBe(25);
    expect(recentDmLimit(undefined)).toBe(10);
    expect(recentDmLimit(0)).toBe(10);
    expect(recentDmLimit(-3)).toBe(10);
    expect(recentDmLimit(2.5)).toBe(10);
    expect(recentDmLimit("7")).toBe(10);
  });
});

describe("resolveSelection", () => {
  test("keeps a selection that is still listed", () => {
    expect(resolveSelection("b", ["a", "b", "c"], ["c", "b"])).toBe("b");
  });

  test("moves to the next listed entry, else the previous, else the first", () => {
    expect(resolveSelection("b", ["a", "b", "c"], ["a", "c"])).toBe("c");
    expect(resolveSelection("c", ["a", "b", "c"], ["a", "b"])).toBe("b");
    expect(resolveSelection("b", ["a", "b", "c"], ["x", "y"])).toBe("x");
    expect(resolveSelection(undefined, [], ["x"])).toBe("x");
  });
});
