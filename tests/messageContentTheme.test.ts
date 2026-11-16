import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import chalk from "chalk";
import { theme } from "../src/ui/theme";
import { type AppHarness, keys, startAppHarness } from "./support/appHarness";
import { loadFixture } from "./support/fixtures";
import { waitFor } from "./support/fakeSlack";

let app: AppHarness;
let colourLevel: typeof chalk.level;

/** Ink only emits colour codes when it thinks the terminal has colour. */
beforeAll(() => {
  colourLevel = chalk.level;
  chalk.level = 3;
});

afterAll(() => {
  chalk.level = colourLevel;
});

afterEach(() => app.stop());

const me = "U123ABC456";
const other = "U222222222";
const mentioned = "U333333333";
const text = `hi <@${me}> and <@${mentioned}> see <https://x.test/a|docs> and \`snip\`\n\`\`\`\ncode here\n\`\`\``;

type Part = { text: string; foreground?: string; background?: string };

const hex = (red: string, green: string, blue: string) =>
  `#${[red, green, blue].map((value) => Number(value).toString(16).padStart(2, "0")).join("")}`;

/** The pieces of a coloured row with the foreground and background each was drawn in; hyperlink escapes are skipped. */
function parts(row: string): Part[] {
  const found: Part[] = [];
  let foreground: string | undefined;
  let background: string | undefined;

  for (const piece of row.split(
    /(\u001b\[[0-9;]*m|\u001b\]8;;[^\u0007\u001b]*(?:\u0007|\u001b\\))/,
  )) {
    const code = /^\u001b\[([0-9;]*)m$/.exec(piece)?.[1];

    if (piece.startsWith("\u001b]")) {
      continue;
    }

    if (code === undefined) {
      found.push({ text: piece, foreground, background });
    } else if (code.startsWith("38;2;")) {
      const [, , red, green, blue] = code.split(";");

      foreground = hex(red!, green!, blue!);
    } else if (code.startsWith("48;2;")) {
      const [, , red, green, blue] = code.split(";");

      background = hex(red!, green!, blue!);
    } else if (code === "39") {
      foreground = undefined;
    } else if (code === "49") {
      background = undefined;
    } else if (code === "0" || code === "") {
      foreground = undefined;
      background = undefined;
    }
  }

  return found;
}

function partWith(needle: string): Part | undefined {
  for (const row of app.coloredScreen()) {
    const part = parts(row).find((candidate) => candidate.text === needle);

    if (part) {
      return part;
    }
  }

  return undefined;
}

function expectThemedMessage() {
  expect(partWith("@egon")).toMatchObject({
    foreground: theme.mentionOfYouText,
    background: theme.mentionOfYouBackground,
  });
  expect(partWith("@stantz")).toMatchObject({
    foreground: theme.mentionText,
    background: theme.mentionBackground,
  });
  expect(partWith("docs")).toMatchObject({ foreground: theme.linkText });
  expect(partWith("snip")).toMatchObject({
    foreground: theme.inlineCodeText,
    background: theme.inlineCodeBackground,
  });
  expect(partWith("code here")).toMatchObject({
    foreground: theme.codeBlockText,
    background: theme.codeBlockBackground,
  });
  expect(partWith("(https://x.test/a)")).toMatchObject({
    foreground: theme.linkAddressText,
  });
}

test("a message in the pane draws mentions, links and code in the theme's colours", async () => {
  app = await startAppHarness({
    columns: 120,
    rows: 30,
    prepare: (slack) => {
      slack.respond("conversations.history", () => ({
        ok: true,
        messages: [
          { type: "message", user: other, text, ts: "1700000300.000100" },
        ],
        has_more: false,
      }));
    },
  });
  await app.waitForScreen("#general", 5000);
  await app.press(keys.enter);
  await app.waitForScreen("code here");

  expectThemedMessage();
});

test("a search result draws the same message in the same colours", async () => {
  const [page] = (await loadFixture("search-messages")) as [
    Record<string, any>,
  ];

  app = await startAppHarness({
    columns: 120,
    rows: 30,
    prepare: (slack) => {
      slack.respond("search.messages", () => ({
        ...page,
        messages: {
          ...page.messages,
          matches: [{ ...page.messages.matches[0], text }],
        },
      }));
      slack.respond("conversations.history", () => ({
        ok: true,
        messages: [],
        has_more: false,
      }));
    },
  });
  await app.waitForScreen("#general", 5000);
  await waitFor(() => app.session.currentUserId);
  await app.press("/");

  for (const character of "proton") {
    await app.press(character);
  }

  await app.press(keys.enter);
  await app.waitForScreen("code here");

  expectThemedMessage();
});
