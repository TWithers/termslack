import { afterEach, expect, test } from "bun:test";
import { waitFor } from "./support/fakeSlack";
import { sidebarGroups } from "../src/ui/app/sidebarEntries";
import { type AppHarness, keys, startAppHarness } from "./support/appHarness";

let app: AppHarness;

afterEach(() => app.stop());

const other = "U222222222";
const general = "C012AB3CD";
const peter = "D0C0F7S8Y";

const ts = (seconds: number) => `${seconds}.000000`;

async function start() {
  app = await startAppHarness({
    unreadCheck: {},
    readMarkDebounceMs: 20,
    prepare: (slack) => {
      slack.respond("conversations.info", ({ params }) => ({
        ok: true,
        channel: {
          id: params.channel,
          last_read: ts(100),
          is_im: String(params.channel).startsWith("D"),
        },
      }));
      slack.respond("conversations.history", ({ params }) => ({
        ok: true,
        messages:
          params.channel === general || params.channel === peter
            ? [{ type: "message", user: other, text: "hi", ts: ts(200) }]
            : [],
      }));
    },
  });
  await app.waitForScreen("@Peter Venkman");
}

const entryFor = (label: string) =>
  [
    ...sidebarGroups(app.session).channels,
    ...sidebarGroups(app.session).directMessages,
  ].find((entry) => entry.label === label)!;

test("conversations unread in Slack before startup show their markers in the sidebar", async () => {
  await start();

  await waitFor(() => entryFor("@Peter Venkman").markers.isUnread);
  await waitFor(() => entryFor("#general").markers.isUnread);

  expect(entryFor("@Peter Venkman").markers.mentions).toBe(1);
  expect(entryFor("#general").markers.mentions).toBe(0);
  expect(entryFor("#random").markers.isUnread).toBe(false);
  await app.waitForScreen(/@Peter Venkman +1/);
});

test("opening an unread conversation clears it and marks it read in Slack", async () => {
  await start();
  await waitFor(() => entryFor("#general").markers.isUnread);

  await app.press(keys.enter);

  await waitFor(() =>
    app.slack.calls.find((call) => call.method === "conversations.mark"),
  );

  const mark = app.slack.calls.find(
    (call) => call.method === "conversations.mark",
  );

  expect(mark?.params).toMatchObject({ channel: general, ts: ts(200) });
  expect(entryFor("#general").markers.isUnread).toBe(false);
});

test("the sidebar border shows the check's progress while it runs and nothing afterwards", async () => {
  app = await startAppHarness({
    unreadCheck: { concurrency: 1 },
    prepare: (slack) => {
      slack.respond("conversations.info", async ({ params }) => {
        await Bun.sleep(150);

        return {
          ok: true,
          channel: { id: params.channel, last_read: ts(100) },
        };
      });
      slack.respond("conversations.history", () => ({
        ok: true,
        messages: [],
      }));
    },
  });

  await app.waitForScreen(/● connected · Unreads \d+\/5/);
  await waitFor(() => app.session.unreadCheckProgress() === undefined);
  await Bun.sleep(50);

  expect(await app.waitForScreen("Peter Venkman")).not.toContain("Unreads");
});
