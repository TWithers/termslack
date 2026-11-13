import { afterEach, expect, test } from "bun:test";
import { type AppHarness, keys, startAppHarness } from "./support/appHarness";
import { waitFor } from "./support/fakeSlack";

let app: AppHarness;

afterEach(() => app.stop());

const venkman = "U222222222";
const stantz = "U333333333";

async function start(
  answer: (user: string) => Record<string, unknown> = (user) => ({
    ok: true,
    presence: user === venkman ? "active" : "away",
  }),
  options: Parameters<typeof startAppHarness>[0] = {},
) {
  app = await startAppHarness({
    presence: { callsPerMinute: 600 },
    ...options,
    prepare: (slack) => {
      slack.respond("users.getPresence", ({ params }) =>
        answer(String(params.user)),
      );
      options.prepare?.(slack);
    },
  });
}

const sidebarRows = () =>
  app
    .screen()
    .split("\n")
    .map((line) => line.slice(0, 32).trimEnd());

/** The presence marker cell of the sidebar row for `name` (`@Peter Venkman`), or undefined when there is no such row. */
const marker = (name: string) =>
  sidebarRows()
    .find((line) => line.slice(3) === name)
    ?.charAt(2);

test("DMs in the sidebar show a filled dot for active and a hollow dot for away", async () => {
  await start();

  await waitFor(() => marker("@Peter Venkman") === "●");
  await waitFor(() => marker("@stantz") === "○");

  expect(marker("#general")).toBe(" ");
  expect(app.screen()).toContain("●@Peter Venkman");
});

test("nothing shows while presence is unknown, and names stay where they were", async () => {
  await start(() => ({ ok: false, error: "user_not_found" }));

  await waitFor(() => marker("@Peter Venkman") !== undefined);
  await waitFor(
    () =>
      app.slack.calls.filter((c) => c.method === "users.getPresence").length >=
      2,
  );
  await Bun.sleep(100);

  expect(marker("@Peter Venkman")).toBe(" ");
  expect(marker("@stantz")).toBe(" ");
});

test("only the people of DMs on screen are checked, not group DMs or the user", async () => {
  await start();

  await waitFor(() => marker("@stantz") === "○");

  const asked = app.slack.calls
    .filter((call) => call.method === "users.getPresence")
    .map((call) => call.params.user);

  expect(new Set(asked)).toEqual(new Set([venkman, stantz]));
});

test("a collapsed Direct messages section is not checked", async () => {
  await start(undefined, {
    collapseMemory: {
      recall: async () => ["directMessages"],
      remember: () => {},
      flush: async () => {},
    },
  });

  await app.waitForScreen("Direct messages");
  await Bun.sleep(300);

  expect(
    app.slack.calls.filter((call) => call.method === "users.getPresence"),
  ).toHaveLength(0);
});

test("the open DM's header shows the dot before the name", async () => {
  await start();

  await waitFor(() => marker("@Peter Venkman") === "●");
  await openRow("@Peter Venkman");

  await waitFor(() =>
    /● @Peter Venkman/.test(app.screen().split("\n")[0]!.slice(32)),
  );
});

test("an away person's header shows the hollow dot", async () => {
  await start();

  await waitFor(() => marker("@stantz") === "○");
  await openRow("@stantz");

  await waitFor(() => /○ @stantz/.test(app.screen().split("\n")[0]!.slice(32)));
});

/** Selects the sidebar row for `name` with the arrow keys and opens it. */
async function openRow(name: string) {
  for (let i = 0; i < 8; i++) {
    const selected = sidebarRows().find((line) => line.startsWith("›"));

    if (selected?.slice(3) === name) {
      break;
    }

    await app.press(keys.down);
  }

  await app.press(keys.enter);
}

test("people below the sidebar's window are checked once they scroll into view", async () => {
  await start(undefined, { rows: 6 });

  await waitFor(() => marker("@Peter Venkman") === "●");
  await Bun.sleep(200);

  const asked = () =>
    app.slack.calls
      .filter((call) => call.method === "users.getPresence")
      .map((call) => call.params.user);

  expect(asked()).toEqual([venkman]);
  expect(marker("@stantz")).toBeUndefined();

  for (let i = 0; i < 6; i++) {
    await app.press(keys.down);
  }

  await waitFor(() => marker("@stantz") === "○");
  expect(asked()).toEqual([venkman, stantz]);
});

test("an open active DM shows the open bar and the green dot in separate cells", async () => {
  await start();

  await waitFor(() => marker("@Peter Venkman") === "●");
  await openRow("@Peter Venkman");

  await waitFor(() => app.screen().includes("›▌●@Peter Venkman"));
});

test("an open DM with unknown presence shows the open bar and no dot", async () => {
  await start(() => ({ ok: false, error: "user_not_found" }));

  await waitFor(() => marker("@Peter Venkman") !== undefined);
  await openRow("@Peter Venkman");

  await waitFor(() => app.screen().includes("›▌ @Peter Venkman"));
  expect(app.screen()).not.toContain("●@Peter Venkman");
});
