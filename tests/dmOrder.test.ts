import { afterEach, expect, test } from "bun:test";
import { loadPayload } from "./support/fixtures";
import { waitFor } from "./support/fakeSlack";
import { type AppHarness, startAppHarness } from "./support/appHarness";
import { memoryDmActivityCache } from "./support/dmActivityCache";
import { sidebarGroups } from "./../src/ui/app/sidebarEntries";

let app: AppHarness;

afterEach(() => app.stop());

const peter = "D0C0F7S8Y";
const ray = "D0BSHH4AD";
const group = "G0AKFJBEU";

const directOrder = () =>
  sidebarGroups(app.session).directMessages.map(
    ({ conversation }) => conversation.id,
  );

const sidebarOrder = () =>
  app
    .screen()
    .split("\n")
    .map((line) => line.slice(0, 32))
    .filter((line) => line.includes("@"))
    .map((line) => line.trim());

async function start(
  updated: Record<string, number>,
  options: Parameters<typeof startAppHarness>[0] = {},
) {
  app = await startAppHarness({
    ...options,
    prepare: (slack) => {
      const handler = slack.handler("users.conversations");

      slack.respond("users.conversations", async (call) => {
        const page = (await handler(call)) as { channels?: any[] };

        return {
          ...page,
          channels: page.channels?.map((channel) =>
            channel.id in updated
              ? { ...channel, updated: updated[channel.id] }
              : channel,
          ),
        };
      });
      options.prepare?.(slack);
    },
  });
  await app.waitForScreen("@Peter Venkman");
}

test("DMs start in the order of the listing's updated time, newest first, falling back to name", async () => {
  await start({ [peter]: 1_000, [ray]: 3_000, [group]: 2_000 });

  expect(directOrder()).toEqual([ray, group, peter]);

  const lines = sidebarOrder();

  expect(lines.findIndex((line) => line.includes("Peter"))).toBeGreaterThan(
    lines.findIndex((line) => line.includes("Egon")),
  );
});

test("DMs without any known time are sorted by name", async () => {
  await start({});

  const labels = sidebarGroups(app.session).directMessages.map(
    ({ label }) => label,
  );

  expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b)));
});

test("the background pass re-sorts the sidebar, and hidden DMs disappear", async () => {
  await start(
    { [peter]: 9_000_000, [ray]: 8_000_000, [group]: 7_000_000 },
    {
      dmActivity: { passDelayMs: 0, cache: memoryDmActivityCache() },
      prepare: (slack) =>
        slack.respond("conversations.history", ({ params }) =>
          params.channel === ray
            ? { ok: false, error: "channel_not_found" }
            : {
                ok: true,
                messages: [
                  {
                    type: "message",
                    user: "U222222222",
                    text: "hi",
                    ts:
                      params.channel === group
                        ? "1700000900.000000"
                        : "1700000100.000000",
                  },
                ],
              },
        ),
    },
  );

  await waitFor(() => app.session.isDmHidden(ray));
  await waitFor(() => directOrder().join() === [group, peter].join());

  expect(app.screen()).not.toContain("U333333333");
});

test("a message in a DM moves it to the top of the sidebar", async () => {
  await start({ [peter]: 3_000, [ray]: 2_000, [group]: 1_000 });

  expect(directOrder()[0]).toBe(peter);

  const payload = await loadPayload("message");

  await app.sendEvents({
    ...payload,
    event: {
      ...payload.event,
      channel: group,
      channel_type: "mpim",
      ts: "1800000000.000100",
    },
  });

  await waitFor(() => directOrder()[0] === group);
});

test("channels keep their name order", async () => {
  await start({});

  const channels = sidebarGroups(app.session).channels.map(
    ({ label }) => label,
  );

  expect(channels).toEqual([...channels].sort((a, b) => a.localeCompare(b)));
});
