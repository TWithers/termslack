import { afterEach, describe, expect, test } from "bun:test";
import { themeChoices } from "../src/ui/app/themeChoices";
import {
  applyTheme,
  currentThemeName,
  defaultThemeName,
} from "../src/ui/theme";
import { type AppHarness, keys, startAppHarness } from "./support/appHarness";
import { waitFor } from "./support/fakeSlack";
import { findPopup } from "./support/popup";

let app: AppHarness | undefined;

afterEach(async () => {
  await app?.stop();
  app = undefined;
  applyTheme(defaultThemeName);
});

const general = "C012AB3CD";
const random = "C061EG9T2";
const sidebarWidth = 32;

const history = (text: string) => ({
  ok: true,
  messages: [
    { type: "message", user: "U222222222", text, ts: "1600000100.000001" },
  ],
  has_more: false,
});

const hit = (channel: string, name: string, ts: string, text: string) => ({
  channel: {
    id: channel,
    name,
    is_channel: true,
    is_im: false,
    is_mpim: false,
  },
  type: "message",
  user: "U222222222",
  ts,
  text,
  permalink: `https://acme.slack.com/archives/${channel}/p${ts.replace(".", "")}`,
});

const saved: string[] = [];

/** #general is open with its pane focused; #random has a message of its own to tell the two apart. */
async function start() {
  saved.length = 0;
  app = await startAppHarness({
    columns: 120,
    rows: 30,
    saveTheme: async (name) => {
      saved.push(name);
    },
    prepare: (slack) => {
      slack.respond("conversations.history", (call) =>
        history(
          call.params.channel === random ? "random words" : "general words",
        ),
      );
      slack.respond("search.messages", () => ({
        ok: true,
        query: "needle",
        messages: {
          total: 2,
          paging: { count: 2, total: 2, page: 1, pages: 1 },
          matches: [
            hit(general, "general", "1600000100.000001", "needle in general"),
            hit(random, "random", "1600000100.000002", "needle in random"),
          ],
        },
      }));
    },
  });
  await app.waitForScreen("#general", 5000);
  await app.press(keys.enter);
  await app.waitForScreen("general words");
  await waitFor(() => app!.session.currentUserId);
  await app.press(keys.tab);
}

const screenRows = () => app!.screen().split("\n");
const statusBar = () => screenRows().at(-1)!;
const paneText = () =>
  screenRows()
    .map((line) => line.slice(sidebarWidth))
    .join("\n");
const messagesFocused = () => statusBar().includes("j/k select");

/** Clicks the row of the popup titled `title` whose text contains `text`. */
async function clickPopupRow(title: string, text: string, column = 5) {
  const popup = findPopup(app!.screen(), title)!;
  const row = popup.rows.findIndex((line) => line.includes(text));

  expect(row).toBeGreaterThan(-1);
  await app!.click(popup.left + column, popup.top + 1 + row);
}

async function search() {
  await app!.press("/");
  await app!.press("needle");
  await app!.press(keys.enter);
  await app!.waitForScreen("needle in random");
}

describe("choosing by click", () => {
  test("a click on a switcher row opens that conversation", async () => {
    await start();
    await app!.press(keys.ctrlK);
    await app!.waitForScreen("Switch conversation");
    await clickPopupRow("Switch conversation", "random");
    await app!.waitForScreen("random words");

    expect(app!.screen()).not.toContain("Switch conversation");
  });

  test("a click on a lower line of a search result opens it", async () => {
    await start();
    await search();

    const popup = findPopup(app!.screen(), "Search messages")!;
    const line = popup.rows.findIndex((row) =>
      row.includes("needle in random"),
    );

    await app!.click(popup.left + 5, popup.top + 1 + line);
    await app!.waitForScreen("random words");

    expect(app!.screen()).not.toContain("Search messages");
  });

  test("a click on a theme row keeps and saves it, as Enter does", async () => {
    const second = themeChoices("")[1]!.name;

    await start();
    await app!.press("T");
    await app!.waitForScreen("Theme");
    await clickPopupRow("Theme", second);
    await waitFor(() => saved.length > 0);

    expect(saved).toEqual([second]);
    expect(currentThemeName).toBe(second);
    expect(findPopup(app!.screen(), "Theme")).toBeUndefined();
  });

  test("a click inside a popup that isn't on a row (the borders, the filter line) does nothing", async () => {
    await start();
    await app!.press(keys.ctrlK);
    await app!.waitForScreen("Switch conversation");

    const popup = findPopup(app!.screen(), "Switch conversation")!;

    await app!.click(popup.left + 5, popup.top);
    await app!.click(popup.left + 5, popup.top + 1);
    await app!.click(popup.left, popup.top + 2);
    await app!.click(popup.left + 5, popup.bottom);

    expect(findPopup(app!.screen(), "Switch conversation")).toBeDefined();

    await app!.press(keys.escape);
    await app!.press("?");
    await app!.waitForScreen("Keyboard shortcuts");

    const help = findPopup(app!.screen(), "Keyboard shortcuts")!;

    await app!.click(help.left + 5, help.top + 3);
    expect(findPopup(app!.screen(), "Keyboard shortcuts")).toBeDefined();
  });
});

describe("clicking outside a popup closes it and touches nothing under the click", () => {
  const stillGeneralInMessages = () => {
    expect(paneText()).toContain("general words");
    expect(paneText()).not.toContain("random words");
    expect(messagesFocused()).toBe(true);
  };

  test("the help", async () => {
    await start();
    await app!.press("?");
    await app!.waitForScreen("Keyboard shortcuts");
    await app!.click(0, 0);
    await waitFor(() => !app!.screen().includes("Keyboard shortcuts"));

    stillGeneralInMessages();
  });

  test("the quick switcher, even over a sidebar entry", async () => {
    await start();
    await app!.press(keys.ctrlK);
    await app!.waitForScreen("Switch conversation");

    const row = screenRows().findIndex((line) =>
      line.slice(0, 20).includes("#random"),
    );

    await app!.click(3, row);
    await waitFor(() => !app!.screen().includes("Switch conversation"));

    stillGeneralInMessages();
  });

  test("the search results", async () => {
    await start();
    await search();
    await app!.click(0, 0);
    await waitFor(() => !app!.screen().includes("Search messages"));

    stillGeneralInMessages();
  });

  test("the reaction prompt, even over a message", async () => {
    await start();
    await app!.press("r");
    await app!.waitForScreen("React with");
    await app!.click(60, 5);
    await waitFor(() => !app!.screen().includes("React with"));

    stillGeneralInMessages();
  });

  test("the theme picker, putting the original theme back", async () => {
    await start();
    await app!.press("T");
    await app!.waitForScreen("Theme");
    await app!.press(keys.down);
    await waitFor(() => currentThemeName !== defaultThemeName);
    await app!.click(0, 0);
    await waitFor(() => findPopup(app!.screen(), "Theme") === undefined);

    expect(currentThemeName).toBe(defaultThemeName);
    expect(saved).toEqual([]);
    stillGeneralInMessages();
  });
});

describe("a y/n question", () => {
  test("is cancelled by a click, which does nothing else", async () => {
    await start();
    await app!.click(5, 20);
    await app!.press("x");
    await app!.waitForScreen("Leave #general? y/n");
    await app!.click(60, 10);
    await waitFor(() => !statusBar().includes("y/n"));

    expect(messagesFocused()).toBe(false);
    expect(
      app!.slack.calls.filter((call) => call.method === "conversations.leave"),
    ).toHaveLength(0);
  });
});
