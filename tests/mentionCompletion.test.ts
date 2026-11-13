import { afterEach, expect, test } from "bun:test";
import { type AppHarness, keys, startAppHarness } from "./support/appHarness";
import { waitFor } from "./support/fakeSlack";

let app: AppHarness;

afterEach(() => app.stop());

const general = "C012AB3CD";
const venkman = "U222222222";

const postCalls = () =>
  app.slack.calls.filter((call) => call.method === "chat.postMessage");

/** Opens #general with the input focused and the people loaded, so the next keys type. */
async function start() {
  app = await startAppHarness({
    columns: 100,
    rows: 24,
    prepare: (slack) => {
      slack.respond("conversations.history", () => ({
        ok: true,
        messages: [],
        has_more: false,
      }));
      slack.respond("usergroups.list", () => ({
        ok: true,
        usergroups: [{ id: "S0614TZR7", handle: "ghostbusters", name: "Team" }],
      }));
    },
  });
  await app.waitForScreen("#general", 5000);
  await app.press(keys.enter);
  await waitFor(() => app.session.currentUserId);
  await waitFor(() => app.session.user(venkman));
  await waitFor(() => app.session.userGroups().length > 0);
  await app.press("i");
}

const inputLine = () =>
  app
    .screen()
    .split("\n")
    .findLast((line) => line.includes("│") && !line.includes("╰")) ?? "";

test("@ opens a list that narrows as you type; Tab completes it", async () => {
  await start();
  await app.press("hi @");
  await app.waitForScreen("@here");
  expect(app.screen()).toContain("@ghostbusters");

  await app.press("ven");
  await app.waitForScreen("@venkman Peter Venkman");
  expect(app.screen()).not.toContain("@here");

  await app.press(keys.tab);
  expect(app.screen()).not.toContain("@venkman Peter Venkman");
  expect(inputLine()).toContain("hi @venkman");

  await app.press(keys.enter);
  await waitFor(() => postCalls().length === 1);
  expect(postCalls()[0]?.params.text).toBe(`hi <@${venkman}>`);
  // The pending message shows the name, as it will once sent.
  await app.waitForScreen("@Peter Venkman");
});

test("Up and Down choose, Enter completes while the list is open instead of sending", async () => {
  await start();
  await app.press("@");
  await app.waitForScreen("@here");
  await app.press(keys.down);
  await app.press(keys.enter);

  expect(postCalls()).toHaveLength(0);
  expect(inputLine()).toContain("@channel");

  await app.press(keys.enter);
  await waitFor(() => postCalls().length === 1);
  expect(postCalls()[0]?.params.text).toBe("<!channel>");
});

test("# completes channels, and a user group completes to its handle", async () => {
  await start();
  await app.press("#ran");
  await app.waitForScreen("#random");
  await app.press(keys.tab);
  await app.press("@ghost");
  await app.press(keys.tab);
  await app.press(keys.enter);

  const random = app.session.conversations().find((c) => c.name === "random")!;

  await waitFor(() => postCalls().length === 1);
  expect(postCalls()[0]?.params.text).toBe(
    `<#${random.id}> <!subteam^S0614TZR7>`,
  );
});

test("Esc closes only the list; the input keeps its focus and text", async () => {
  await start();
  await app.press("@ven");
  await app.waitForScreen("@venkman Peter Venkman");
  await app.press(keys.escape);

  expect(app.screen()).not.toContain("@venkman Peter Venkman");
  expect(inputLine()).toContain("@ven");

  await app.press("x");
  expect(inputLine()).toContain("@venx");

  await app.press(keys.escape);
  expect(app.screen()).toContain("j/k select");
});

test("a hand-typed name converts when unique and stays plain otherwise", async () => {
  await start();
  await app.press("@venkman and @nobody ");
  await app.press(keys.enter);

  await waitFor(() => postCalls().length === 1);
  expect(postCalls()[0]?.params.text).toBe(`<@${venkman}> and @nobody`);
});
