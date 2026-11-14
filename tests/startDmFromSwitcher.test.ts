import { afterEach, expect, test } from "bun:test";
import { loadFixture } from "./support/fixtures";
import { waitFor, type FakeSlack } from "./support/fakeSlack";
import { findPopup } from "./support/popup";
import { type AppHarness, keys, startAppHarness } from "./support/appHarness";

let app: AppHarness;

afterEach(() => app.stop());

const ray = "U555555555";
const newDm = "D069C7QFK";

const extraPeople = {
  ok: true,
  members: [
    {
      id: ray,
      name: "rparker",
      deleted: false,
      real_name: "Raymond Parker",
      profile: { real_name: "Raymond Parker", display_name: "Ray" },
      is_bot: false,
    },
    {
      id: "U666666666",
      name: "gone",
      deleted: true,
      real_name: "Gone Person",
      profile: { real_name: "Gone Person", display_name: "Gone" },
      is_bot: false,
    },
    {
      id: "U777777777",
      name: "buildbot",
      deleted: false,
      real_name: "Build Bot",
      profile: { real_name: "Build Bot", display_name: "Build Bot" },
      is_bot: true,
    },
  ],
  response_metadata: { next_cursor: "" },
};

/** The small workspace plus a third page of people: Ray (no DM), a deleted user and a bot. */
async function addPeople(slack: FakeSlack, beforeLastPage?: Promise<void>) {
  const [first, second] = await loadFixture("users-list");
  const pages = [
    first!,
    {
      ...second!,
      response_metadata: { next_cursor: "page3" },
    },
    extraPeople,
  ];

  slack.respondPaged("users.list", pages);

  if (beforeLastPage) {
    const paged = slack.handler("users.list");

    slack.respond("users.list", async (call) => {
      if (call.params.cursor === "page3") {
        await beforeLastPage;
      }

      return paged(call);
    });
  }
}

async function start({
  scopes,
  open,
  gate,
  ...options
}: {
  scopes?: string[];
  open?: Parameters<FakeSlack["respond"]>[1];
  gate?: Promise<void>;
} & Parameters<typeof startAppHarness>[0] = {}) {
  const [created] = await loadFixture("conversations-open");

  app = await startAppHarness({
    rows: 30,
    ...options,
    prepare: async (slack) => {
      await addPeople(slack, gate);

      if (scopes) {
        slack.grantScopes(scopes);
      }

      slack.respond("conversations.open", open ?? (() => created!));
      slack.respond("conversations.history", () => ({
        ok: true,
        messages: [],
        has_more: false,
      }));
    },
  });
  await app.waitForScreen("@Peter Venkman");
  await waitFor(() => app.session.currentUserId);
}

const statusLineText = () => app.screen().trimEnd().split("\n").at(-1)!;
const switcherIsOpen = () => app.screen().includes("Switch conversation");
const switcherTitle = () =>
  app
    .screen()
    .split("\n")
    .find((line) => line.includes("Switch conversation")) ?? "";

const results = (): string[] => {
  return (findPopup(app.screen(), "Switch conversation")?.rows ?? [])
    .slice(1)
    .map((line) => line.replace(/^\s*(› )?/, "").trimEnd())
    .filter(Boolean);
};

const sidebarRows = () =>
  app
    .screen()
    .split("\n")
    .map((line) => line.slice(0, 32).trim());

async function type(text: string) {
  for (const character of text) {
    await app.press(character);
  }
}

const openCalls = () =>
  app.slack.calls.filter((call) => call.method === "conversations.open");

async function pickRay() {
  await app.press(keys.ctrlK);
  await type("ray");
  await app.press(keys.enter);
}

test("people without a DM are listed by name with their other names alongside; deleted users and bots are left out and you are included", async () => {
  await start();

  await app.press(keys.ctrlK);
  await type("e");

  const rows = results();

  expect(rows).toContain("@Ray Raymond Parker · rparker");
  expect(rows).toContain("@egon Egon Spengler · spengler");
  expect(rows.join("\n")).not.toContain("Gone");
  expect(rows.join("\n")).not.toContain("buildbot");
  expect(rows.join("\n")).not.toContain("Build Bot");
});

test("a person with a DM appears once, as the DM, and still matches on real name and username", async () => {
  await start();
  await app.press(keys.ctrlK);

  await type("venkman");

  expect(results().filter((row) => row === "@Peter Venkman")).toHaveLength(1);
  expect(results().some((row) => row.includes("·"))).toBe(false);
});

test("a person without a DM matches on display name, real name and username", async () => {
  await start();
  await app.press(keys.ctrlK);

  for (const name of ["ray", "raymond", "rparker"]) {
    await type(name);

    expect(results()).toContain("@Ray Raymond Parker · rparker");

    for (let i = 0; i < name.length; i += 1) {
      await app.press(keys.backspace);
    }
  }
});

test("picking a person without a DM opens it with conversations.open, adds it to the sidebar once and opens it", async () => {
  await start();

  await pickRay();
  await waitFor(() => app.session.conversation(newDm));

  expect(openCalls().map((call) => call.params)).toEqual([{ users: ray }]);
  expect(switcherIsOpen()).toBe(false);
  expect(app.screen()).toContain("›▌ @Ray");
  expect(statusLineText()).toContain("j/k select");
  expect(sidebarRows().filter((row) => row.includes("@Ray"))).toHaveLength(1);

  await app.press(keys.ctrlK);
  await type("ray");

  expect(results().filter((row) => row.startsWith("@Ray"))).toEqual(["@Ray"]);
});

test("the new DM shows in the sidebar even when it would fall outside the recent DMs", async () => {
  await start({ recentDms: 1 });

  await pickRay();
  await app.waitForScreen("›▌ @Ray");

  await app.press(keys.tab);
  await app.press(keys.tab);
  await app.press(keys.tab);

  expect(sidebarRows().some((row) => row.includes("@Ray"))).toBe(true);
});

test("without im:write the person still shows, and picking them explains in the status line without calling Slack", async () => {
  await start({ scopes: ["identify", "chat:write", "reactions:write"] });
  await app.press(keys.ctrlK);
  await type("ray");

  expect(results()).toContain("@Ray Raymond Parker · rparker");

  await app.press(keys.enter);

  expect(switcherIsOpen()).toBe(false);
  expect(statusLineText()).toContain("Starting direct messages is off");
  expect(statusLineText()).toContain("im:write");
  expect(openCalls()).toHaveLength(0);
  expect(app.session.conversation(newDm)).toBeUndefined();
});

test("Slack refusing shows the reason, closes the switcher and changes nothing", async () => {
  await start({
    scopes: ["identify", "im:write"],
    open: () => ({ ok: false, error: "user_disabled" }),
  });
  const before = app.session.conversations().length;

  await pickRay();
  await waitFor(() => openCalls().length === 1);
  await app.waitForScreen("deactivated");

  expect(switcherIsOpen()).toBe(false);
  expect(statusLineText()).toContain("deactivated");
  expect(app.session.conversations()).toHaveLength(before);
  expect(sidebarRows().some((row) => row.includes("@Ray"))).toBe(false);
});

test("while the people list is still loading the switcher shows who is known so far and says it is loading", async () => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));

  await start({ gate });
  await app.press(keys.ctrlK);
  await type("ray");

  expect(switcherTitle()).toContain("still loading people");
  expect(results()).toEqual([]);

  await app.press(keys.backspace);
  await app.press(keys.backspace);
  await app.press(keys.backspace);
  await type("egon");

  expect(results()).toContain("@egon Egon Spengler · spengler");

  release();
  await waitFor(() => app.session.listingHealth().people === "loaded");
  await waitFor(() => !switcherTitle().includes("still loading"));

  for (let i = 0; i < "egon".length; i += 1) {
    await app.press(keys.backspace);
  }

  await type("ray");

  expect(results()).toContain("@Ray Raymond Parker · rparker");
});

test("a slow DM start doesn't switch away from a conversation opened meanwhile, but the DM still lands in the sidebar", async () => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  const [created] = await loadFixture("conversations-open");

  await start({
    open: async () => {
      await gate;

      return created!;
    },
  });

  await pickRay();
  await waitFor(() => openCalls().length === 1);
  await app.press(keys.enter);
  await app.waitForScreen("›▌ #general");

  release();
  await waitFor(() => app.session.conversation(newDm));
  await waitFor(() => sidebarRows().some((row) => row.includes("@Ray")));

  expect(app.screen()).toContain("›▌ #general");
  expect(app.screen()).not.toContain("▌ @Ray");
});
