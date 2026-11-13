import { afterEach, expect, test } from "bun:test";
import { waitFor } from "./support/fakeSlack";
import { seedWorkspace } from "./support/appHarness";
import {
  type SessionHarness,
  startSessionHarness,
} from "./support/sessionHarness";

let harness: SessionHarness;

afterEach(() => harness.stop());

/** Fails the first `failures` calls of a method, then answers like seeded Slack. */
async function startFailing(
  method: "users.conversations" | "users.list",
  failures: number,
  retryDelaysMs = [60, 60, 60],
) {
  let calls = 0;

  harness = await startSessionHarness({
    listingRetryDelaysMs: retryDelaysMs,
    prepare: async (slack) => {
      await seedWorkspace(slack);

      slack.respond(method, async () => {
        calls += 1;

        if (calls <= failures) {
          return { ok: false, error: "ratelimited" };
        }

        return recovered(method);
      });
    },
  });

  return () => calls;
}

async function recovered(method: string): Promise<Record<string, unknown>> {
  if (method === "users.list") {
    return {
      ok: true,
      members: [{ id: "U9", name: "ray", profile: { display_name: "ray" } }],
    };
  }

  return {
    ok: true,
    channels: [{ id: "C9", name: "ghostbusters", is_channel: true }],
  };
}

test("listings are healthy once loaded", async () => {
  harness = await startSessionHarness({
    prepare: (slack) => seedWorkspace(slack),
  });

  await waitFor(
    () => harness.session.listingHealth().conversations === "loaded",
  );
  await waitFor(() => harness.session.listingHealth().people === "loaded");
});

test("a failed conversation listing is reported and retried until it loads", async () => {
  const calls = await startFailing("users.conversations", 2);

  await waitFor(
    () => harness.session.listingHealth().conversations === "retrying",
  );
  await waitFor(() => harness.session.conversation("C9"));

  expect(harness.session.listingHealth().conversations).toBe("loaded");
  expect(calls()).toBe(3);
});

test("a failed people listing is reported and retried until it loads", async () => {
  await startFailing("users.list", 1);

  await waitFor(() => harness.session.listingHealth().people === "retrying");
  await waitFor(() => harness.session.user("U9"));

  expect(harness.session.listingHealth().people).toBe("loaded");
});

test("retrying stops after the last delay and the listing stays failed", async () => {
  const calls = await startFailing("users.conversations", 100, [20, 20]);

  await waitFor(
    () => harness.session.listingHealth().conversations === "failed",
  );
  await Bun.sleep(40);

  expect(calls()).toBe(3);
  expect(harness.session.listingHealth().conversations).toBe("failed");
});

test("health changes notify views", async () => {
  await startFailing("users.conversations", 1);

  const before = harness.session.version();

  await waitFor(
    () => harness.session.listingHealth().conversations === "loaded",
  );

  expect(harness.session.version()).not.toBe(before);
});

test("stopping the session cancels pending retries", async () => {
  const calls = await startFailing("users.conversations", 100, [30, 30]);

  await waitFor(
    () => harness.session.listingHealth().conversations === "retrying",
  );
  await harness.session.stop();
  await Bun.sleep(100);

  expect(calls()).toBe(1);
});
