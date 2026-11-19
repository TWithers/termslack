import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import chalk from "chalk";
import { buttonAt, withHoveredButton } from "../src/ui/app/buttons";
import type { PaneRow } from "../src/ui/app/paneRows";
import { theme } from "../src/ui/theme";
import { type AppHarness, keys, startAppHarness } from "./support/appHarness";
import { statusLine } from "./support/panes";

const view = { url: "https://example.com/t/1" };
const edit = {};

/** `  [View task] [Edit task]` with the first label split in two runs, as an emoji or a style change splits it. */
const row: PaneRow = {
  key: "1600000000.000001:2",
  kind: "message",
  messageTs: "1600000000.000001",
  runs: [
    { text: "  " },
    { text: "[View", action: view, url: view.url },
    { text: " task]", action: view, url: view.url, bold: true },
    { text: " " },
    { text: "[Edit task]", action: edit },
  ],
};

describe("buttonAt", () => {
  test("finds the label under a column, from where it starts", () => {
    expect(buttonAt(row, 2)).toEqual({ start: 2, action: view });
    expect(buttonAt(row, 8)).toEqual({ start: 2, action: view });
    expect(buttonAt(row, 12)).toEqual({ start: 2, action: view });
    expect(buttonAt(row, 14)).toEqual({ start: 14, action: edit });
    expect(buttonAt(row, 24)).toEqual({ start: 14, action: edit });
  });

  test("finds nothing between, before or after the labels", () => {
    expect(buttonAt(row, 0)).toBeUndefined();
    expect(buttonAt(row, 13)).toBeUndefined();
    expect(buttonAt(row, 25)).toBeUndefined();
    expect(buttonAt(row, -1)).toBeUndefined();
  });

  test("counts wide characters as two columns", () => {
    const wide: PaneRow = {
      ...row,
      runs: [{ text: "🎉 " }, { text: "[Go]", action: edit }],
    };

    expect(buttonAt(wide, 2)).toBeUndefined();
    expect(buttonAt(wide, 3)).toEqual({ start: 3, action: edit });
  });

  test("two labels with the same action side by side are still two", () => {
    const shared = { url: "https://example.com" };
    const twice: PaneRow = {
      ...row,
      runs: [
        { text: "[A]", action: shared },
        { text: " " },
        { text: "[B]", action: shared },
      ],
    };

    expect(buttonAt(twice, 4)).toEqual({ start: 4, action: shared });
  });
});

describe("withHoveredButton", () => {
  const hover = theme.buttonHoverBackground;

  test("draws every run of the hovered label in the hover background and leaves the rest", () => {
    const [drawn] = withHoveredButton([row], { key: row.key, start: 2 });

    expect(drawn!.runs.map((run) => run.backgroundColor)).toEqual([
      undefined,
      hover,
      hover,
      undefined,
      undefined,
    ]);
    expect(drawn!.runs[2]).toMatchObject({ bold: true, text: " task]" });
  });

  test("leaves other rows, and every row when nothing is hovered, as they are", () => {
    const other = { ...row, key: "other" };

    expect(
      withHoveredButton([row, other], { key: row.key, start: 14 })[1],
    ).toBe(other);
    expect(withHoveredButton([row], undefined)[0]).toBe(row);
  });

  test("a hovered start that no longer has a label changes nothing", () => {
    const [drawn] = withHoveredButton([row], { key: row.key, start: 13 });

    expect(drawn!.runs.every((run) => run.backgroundColor === undefined)).toBe(
      true,
    );
  });
});

describe("buttons in the app", () => {
  let app: AppHarness | undefined;
  let colourLevel: typeof chalk.level;
  const opened: string[] = [];

  /** Ink only emits colour codes when it thinks the terminal has colour. */
  beforeAll(() => {
    colourLevel = chalk.level;
    chalk.level = 3;
  });

  afterAll(() => {
    chalk.level = colourLevel;
  });

  afterEach(async () => {
    await app?.stop();
    app = undefined;
    opened.length = 0;
  });

  const nbsp = "\u00a0";
  const viewLabel = `[View${nbsp}task]`;
  const editLabel = `[Edit${nbsp}task]`;
  const scriptLabel = `[Run${nbsp}it]`;

  const button = (text: string, extra: Record<string, unknown> = {}) => ({
    type: "button",
    text: { type: "plain_text", text },
    ...extra,
  });

  async function start() {
    app = await startAppHarness({
      columns: 100,
      rows: 30,
      openUrl: (url) => opened.push(url),
      prepare: (slack) => {
        slack.respond("conversations.history", () => ({
          ok: true,
          messages: [
            {
              type: "message",
              user: "U222222222",
              text: "Task created",
              ts: "1600000000.000001",
              attachments: [
                {
                  color: "#5f55ee",
                  blocks: [
                    {
                      type: "actions",
                      elements: [
                        button("View task", { url: "https://example.com/t/1" }),
                        button("Edit task", { value: "{}" }),
                        button("Run it", { url: "javascript:alert(1)" }),
                      ],
                    },
                  ],
                },
              ],
            },
          ],
          has_more: false,
        }));
      },
    });
    await app.waitForScreen("#general", 5000);
    await app.press(keys.enter);
    await app.waitForScreen(viewLabel);
  }

  /** The screen column and row where `text` is drawn. */
  function whereIs(text: string): { column: number; row: number } {
    const lines = app!.screen().split("\n");
    const row = lines.findIndex((line) => line.includes(text));

    return { column: lines[row]!.indexOf(text), row };
  }

  async function click(text: string, offset = 1) {
    const { column, row } = whereIs(text);

    await app!.click(column + offset, row);
  }

  const hoverCode = () => {
    const [red, green, blue] = [1, 3, 5].map((at) =>
      Number.parseInt(theme.buttonHoverBackground.slice(at, at + 2), 16),
    );

    return `\u001b[48;2;${red};${green};${blue}m`;
  };

  /** The text drawn in the hover background on `row`: up to the next background change. */
  function hoveredText(row: number): string {
    const line = app!.coloredScreen()[row]!;
    const from = line.indexOf(hoverCode());

    if (from < 0) {
      return "";
    }

    const after = line.slice(from + hoverCode().length);
    const end = after.search(/\u001b\[(48;|49m)/);

    return Bun.stripANSI(end < 0 ? after : after.slice(0, end));
  }

  test("clicking a link button opens its address", async () => {
    await start();
    await click(viewLabel, 3);

    expect(opened).toEqual(["https://example.com/t/1"]);
    expect(statusLine(app!.screen())).not.toContain(
      "isn't currently supported",
    );
  });

  test("clicking an action button opens nothing and says the action isn't supported", async () => {
    await start();
    await click(editLabel);

    expect(opened).toEqual([]);
    expect(statusLine(app!.screen())).toContain(
      "This action isn't currently supported",
    );
  });

  test("a button whose address isn't a web address is treated as unsupported", async () => {
    await start();
    await click(scriptLabel);

    expect(opened).toEqual([]);
    expect(statusLine(app!.screen())).toContain(
      "This action isn't currently supported",
    );
  });

  test("clicking beside the buttons does nothing but select the message", async () => {
    await start();

    const { column, row } = whereIs(viewLabel);

    await app!.click(column - 1, row);
    await app!.click(column + viewLabel.length, row);

    expect(opened).toEqual([]);
    expect(statusLine(app!.screen())).not.toContain(
      "isn't currently supported",
    );
  });

  test("the button under the pointer is drawn in the hover background, and only while the pointer is on it", async () => {
    await start();

    const { column, row } = whereIs(viewLabel);

    expect(hoveredText(row)).toBe("");

    await app!.hover(column + 4, row);
    expect(hoveredText(row)).toBe(viewLabel);

    await app!.hover(whereIs(editLabel).column, row);
    expect(hoveredText(row)).toBe(editLabel);

    await app!.hover(column - 2, row);
    expect(hoveredText(row)).toBe("");

    await app!.hover(column, row);
    await app!.loseTerminalFocus();
    expect(hoveredText(row)).toBe("");
  });
});
