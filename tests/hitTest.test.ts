import { expect, test } from "bun:test";
import { hitTest, type MouseLayout } from "../src/ui/app/hitTest";
import { paneWidths } from "../src/ui/app/paneLayout";

/** 160x30: a 32-column sidebar, body of 29 rows, status bar on row 29. */
function layout(overrides: Partial<MouseLayout> = {}): MouseLayout {
  const columns = overrides.columns ?? 160;
  const sidebarWidth = 32;
  const hasThread = overrides.hasThread ?? false;

  return {
    columns,
    rows: 30,
    sidebarWidth,
    bodyHeight: 29,
    panes: paneWidths(columns - sidebarWidth, hasThread),
    hasConversation: true,
    hasThread,
    messageInputHeight: 3,
    threadInputHeight: 4,
    ...overrides,
  };
}

test("the sidebar, the message pane, its input box and the status bar", () => {
  const l = layout();

  expect(hitTest(l, 0, 0)).toEqual({ area: "sidebar", column: 0, row: 0 });
  expect(hitTest(l, 31, 10)).toEqual({ area: "sidebar", column: 31, row: 10 });
  expect(hitTest(l, 32, 0)).toEqual({ area: "messages", column: 0, row: 0 });
  expect(hitTest(l, 159, 25)).toEqual({
    area: "messages",
    column: 127,
    row: 25,
  });
  expect(hitTest(l, 40, 26)).toEqual({ area: "input", column: 8, row: 0 });
  expect(hitTest(l, 40, 28)).toEqual({ area: "input", column: 8, row: 2 });
  expect(hitTest(l, 5, 29)).toEqual({ area: "statusBar", column: 5 });
  expect(hitTest(l, 159, 29)).toEqual({ area: "statusBar", column: 159 });
});

test("with the thread open the area is shared, each pane with its own input box", () => {
  const l = layout({ hasThread: true });
  const { message } = l.panes;

  expect(hitTest(l, 32 + message - 1, 5)).toMatchObject({ area: "messages" });
  expect(hitTest(l, 32 + message, 5)).toEqual({
    area: "thread",
    column: 0,
    row: 5,
  });
  expect(hitTest(l, 32 + message - 1, 27)).toMatchObject({ area: "input" });
  expect(hitTest(l, 32 + message, 25)).toEqual({
    area: "threadInput",
    column: 0,
    row: 0,
  });
  expect(hitTest(l, 32 + message, 24)).toMatchObject({ area: "thread" });
});

test("on a narrow terminal the thread takes the message pane's place", () => {
  const l = layout({ columns: 110, hasThread: true });

  expect(l.panes.showMessages).toBe(false);
  expect(hitTest(l, 32, 5)).toEqual({ area: "thread", column: 0, row: 5 });
  expect(hitTest(l, 109, 28)).toMatchObject({ area: "threadInput" });
  expect(hitTest(l, 31, 5)).toMatchObject({ area: "sidebar" });
});

test("with no conversation open the space beside the sidebar is nothing", () => {
  const l = layout({ hasConversation: false });

  expect(hitTest(l, 50, 5)).toEqual({ area: "none" });
  expect(hitTest(l, 50, 28)).toEqual({ area: "none" });
  expect(hitTest(l, 5, 5)).toMatchObject({ area: "sidebar" });
});

test("points off the screen are nothing", () => {
  const l = layout();

  expect(hitTest(l, 160, 5)).toEqual({ area: "none" });
  expect(hitTest(l, 5, 30)).toEqual({ area: "none" });
  expect(hitTest(l, -1, 5)).toEqual({ area: "none" });
});

test("a popup is checked first and gives the point relative to itself", () => {
  const l = layout({
    popup: {
      kind: "switcher",
      frame: { top: 5, left: 50, width: 60, height: 8 },
    },
  });

  expect(hitTest(l, 50, 5)).toEqual({
    area: "popup",
    popup: "switcher",
    column: 0,
    row: 0,
  });
  expect(hitTest(l, 109, 12)).toEqual({
    area: "popup",
    popup: "switcher",
    column: 59,
    row: 7,
  });
  expect(hitTest(l, 110, 12)).toMatchObject({ area: "messages" });
  expect(hitTest(l, 49, 5)).toMatchObject({ area: "messages" });
  expect(hitTest(l, 10, 5)).toMatchObject({ area: "sidebar" });
});

test("the reaction prompt is a popup over the panes", () => {
  const l = layout({
    bodyHeight: 26,
    popup: {
      kind: "reaction",
      frame: { top: 5, left: 52, width: 56, height: 4 },
    },
  });

  expect(hitTest(l, 70, 6)).toEqual({
    area: "popup",
    popup: "reaction",
    column: 18,
    row: 1,
  });
  expect(hitTest(l, 70, 25)).toMatchObject({ area: "input" });
  expect(hitTest(l, 70, 9)).not.toMatchObject({ area: "popup" });
});
