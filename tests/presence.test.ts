import { afterEach, expect, test } from "bun:test";
import { seedWorkspace } from "./support/appHarness";
import { fakeClock, type FakeClock } from "./support/fakeClock";
import { loadFixture } from "./support/fixtures";
import { type FakeSlack, waitFor } from "./support/fakeSlack";
import {
  type SessionHarness,
  startSessionHarness,
} from "./support/sessionHarness";

let harness: SessionHarness;
let clock: FakeClock;
/** The clock time of every `users.getPresence` call, with who it asked about. */
let asked: { at: number; user: string }[];

afterEach(() => harness.stop());

const me = "U123ABC456";
const venkman = "U222222222";
const stantz = "U333333333";
const robot = "U555555555";

const minute = 60_000;

const people = (count: number) =>
  Array.from({ length: count }, (_, i) => `U90${String(i).padStart(7, "0")}`);

async function start(
  options: {
    presence?: Parameters<typeof startSessionHarness>[0] extends infer O
      ? O extends { presence?: infer P }
        ? P
        : never
      : never;
    answer?: (user: string, call: number) => Record<string, unknown> | Response;
  } = {},
) {
  clock = fakeClock();
  asked = [];

  const [active, away] = await loadFixture("users-get-presence");
  const awayUsers = new Set([stantz]);

  harness = await startSessionHarness({
    clock,
    presence: options.presence,
    prepare: async (slack) => {
      await seedWorkspace(slack);

      slack.respond("users.list", () => ({
        ok: true,
        members: [
          { id: me, name: "spengler", profile: {} },
          { id: venkman, name: "venkman", profile: {} },
          { id: stantz, name: "stantz", profile: {} },
          { id: robot, name: "robot", is_bot: true, profile: {} },
        ],
      }));

      slack.respond("users.getPresence", ({ params }) => {
        const user = String(params.user);

        asked.push({ at: clock.now(), user });

        return (
          options.answer?.(user, asked.length) ??
          (awayUsers.has(user) ? away! : active!)
        );
      });
    },
  });

  await waitFor(
    () =>
      harness.session.currentUserId &&
      harness.session.listingHealth().people === "loaded",
  );
}

/** Lets time pass `ms` at a time, giving each call that falls due a moment to finish. */
async function pass(totalMs: number, stepMs = 500) {
  for (let elapsed = 0; elapsed < totalMs; elapsed += stepMs) {
    clock.advance(stepMs);
    await Bun.sleep(15);
  }
}

/**
 * The calls made within a minute of the first (less a second, as the clock
 * can move on while a call is on its way and the time noted is a little late).
 */
const inFirstMinute = () =>
  asked.filter((call) => call.at < asked[0]!.at + minute - 1000);

const askedAbout = (user: string) => asked.filter((call) => call.user === user);

test("people on screen are checked and read back as active or away", async () => {
  await start();

  let notified = 0;

  harness.session.subscribeToChanges(() => notified++);
  harness.session.setVisiblePeople([venkman, stantz]);
  await pass(3000);

  await waitFor(() => harness.session.presence(stantz));

  expect(harness.session.presence(venkman)).toBe("active");
  expect(harness.session.presence(stantz)).toBe("away");
  expect(notified).toBeGreaterThan(0);
  expect(harness.session.presence("U999999999")).toBeUndefined();
});

test("the user, bots and people not on screen are not checked", async () => {
  await start();
  harness.session.setVisiblePeople([me, robot, venkman]);
  await pass(20_000);

  expect(asked.map((call) => call.user)).toEqual([venkman]);
});

test("a person who has never been checked is checked as soon as they are on screen", async () => {
  await start();
  harness.session.setVisiblePeople([venkman]);
  clock.advance(0);

  await waitFor(() => asked.length === 1);
});

test("at most 20 calls a minute, spread out rather than in a burst", async () => {
  await start();
  harness.session.setVisiblePeople(people(40));
  await pass(minute, 250);

  expect(inFirstMinute().length).toBeLessThanOrEqual(20);
  expect(inFirstMinute().length).toBeGreaterThanOrEqual(18);

  const gaps = asked.slice(1).map((call, i) => call.at - asked[i]!.at);

  expect(Math.min(...gaps)).toBeGreaterThanOrEqual(2000);
});

test("the per-minute cap and refresh interval can be set", async () => {
  await start({ presence: { callsPerMinute: 6, refreshIntervalMs: minute } });
  harness.session.setVisiblePeople(people(10));
  await pass(minute, 500);

  expect(inFirstMinute().length).toBeLessThanOrEqual(6);
  expect(inFirstMinute().length).toBeGreaterThanOrEqual(5);
});

test("a person is checked again only after the refresh interval", async () => {
  await start();
  harness.session.setVisiblePeople([venkman]);
  await pass(1000);
  await waitFor(() => harness.session.presence(venkman));

  await pass(4 * minute + 30_000, 10_000);

  expect(asked).toHaveLength(1);

  await pass(40_000, 5000);
  await waitFor(() => asked.length === 2);
});

test("someone who scrolls into view is checked soon without rechecking the others", async () => {
  await start();
  harness.session.setVisiblePeople([venkman]);
  await pass(1000);
  await waitFor(() => harness.session.presence(venkman));

  harness.session.setVisiblePeople([venkman, stantz]);
  await pass(4000, 500);

  await waitFor(() => harness.session.presence(stantz));

  expect(askedAbout(venkman)).toHaveLength(1);
});

test("presence of someone off screen is forgotten after ten minutes, and they are checked again on return", async () => {
  await start({ presence: { refreshIntervalMs: 20 * minute } });
  harness.session.setVisiblePeople([venkman]);
  await pass(1000);
  await waitFor(() => harness.session.presence(venkman));

  harness.session.setVisiblePeople([]);
  await pass(9 * minute, 30_000);

  expect(harness.session.presence(venkman)).toBe("active");

  await pass(minute + 1000, 30_000);

  expect(harness.session.presence(venkman)).toBeUndefined();

  harness.session.setVisiblePeople([venkman]);
  await pass(4000, 500);

  await waitFor(() => harness.session.presence(venkman));

  expect(askedAbout(venkman)).toHaveLength(2);
});

test("a rate-limited call slows the service down and never loses the person", async () => {
  await start({
    answer: (_user, call) =>
      call === 1
        ? new Response("", { status: 429, headers: { "retry-after": "0" } })
        : { ok: true, presence: "away" },
  });
  harness.session.setVisiblePeople([venkman]);
  await pass(1000);
  await waitFor(() => asked.length === 1);
  await pass(4000, 500);

  expect(asked).toHaveLength(1);

  await pass(3000, 500);
  await waitFor(() => harness.session.presence(venkman));

  expect(asked).toHaveLength(2);
  expect(asked[1]!.at - asked[0]!.at).toBeGreaterThanOrEqual(5000);
  expect(harness.session.presence(venkman)).toBe("away");
});

test("an error about a person leaves them unknown, quietly, until the next refresh", async () => {
  await start({
    answer: (user) =>
      user === venkman
        ? { ok: false, error: "user_not_found" }
        : { ok: true, presence: "active" },
  });
  harness.session.setVisiblePeople([venkman, stantz]);
  await pass(10_000);
  await waitFor(() => harness.session.presence(stantz));

  expect(harness.session.presence(venkman)).toBeUndefined();
  expect(askedAbout(venkman)).toHaveLength(1);
  expect(harness.session.dndNote()).toBeUndefined();
  expect(harness.events.some((event) => "error" in event && event.error)).toBe(
    false,
  );

  await pass(5 * minute, 15_000);

  expect(askedAbout(venkman)).toHaveLength(2);
});

test("a missing permission ends the polling", async () => {
  await start({ answer: () => ({ ok: false, error: "missing_scope" }) });
  harness.session.setVisiblePeople([venkman, stantz]);
  await pass(30 * minute, 30_000);

  expect(asked).toHaveLength(1);
  expect(harness.session.presence(venkman)).toBeUndefined();
});

test("stopping the session stops the polling", async () => {
  await start();
  harness.session.setVisiblePeople(people(10));
  await pass(1000);
  await waitFor(() => asked.length >= 1);
  await harness.session.stop();

  const seen = asked.length;

  await pass(2 * minute, 5000);

  expect(asked).toHaveLength(seen);
});
