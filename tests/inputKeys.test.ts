import { describe, expect, test } from "bun:test";
import { handleInputKey, type InputKey } from "../src/ui/input/inputKeys";
import { type InputState } from "../src/ui/input/textInput";

const none: InputKey = {};

function press(state: InputState, input: string, key: InputKey = none) {
  return handleInputKey(state, input, key);
}

const hello: InputState = { text: "hello", cursor: 5 };

describe("input keys", () => {
  test("letters are typed, pastes included", () => {
    expect(press(hello, "!")).toEqual({
      kind: "edit",
      state: { text: "hello!", cursor: 6 },
    });
    expect(press({ text: "", cursor: 0 }, "a\nb")).toEqual({
      kind: "edit",
      state: { text: "a\nb", cursor: 3 },
    });
  });

  test("Enter sends; Shift+Enter, Alt+Enter and Ctrl+J (a bare newline) insert a newline", () => {
    expect(press(hello, "\r", { return: true })).toEqual({ kind: "send" });

    for (const key of [
      { return: true, shift: true },
      { return: true, meta: true },
    ]) {
      expect(press(hello, "\r", key)).toEqual({
        kind: "edit",
        state: { text: "hello\n", cursor: 6 },
      });
    }

    expect(press(hello, "\n")).toEqual({
      kind: "edit",
      state: { text: "hello\n", cursor: 6 },
    });
  });

  test("Escape leaves the input", () => {
    expect(press(hello, "", { escape: true })).toEqual({ kind: "leave" });
  });

  test("arrows, Home and End move the cursor", () => {
    expect(press(hello, "", { leftArrow: true })).toMatchObject({
      state: { cursor: 4 },
    });
    expect(
      press({ ...hello, cursor: 1 }, "", { rightArrow: true }),
    ).toMatchObject({
      state: { cursor: 2 },
    });
    expect(press(hello, "", { home: true })).toMatchObject({
      state: { cursor: 0 },
    });
    expect(press({ ...hello, cursor: 0 }, "", { end: true })).toMatchObject({
      state: { cursor: 5 },
    });
    expect(
      press({ text: "a\nb", cursor: 3 }, "", { upArrow: true }),
    ).toMatchObject({
      state: { cursor: 1 },
    });
  });

  test("Alt+arrows and Alt+b/f move by words", () => {
    const text = { text: "one two", cursor: 7 };

    expect(press(text, "", { leftArrow: true, meta: true })).toMatchObject({
      state: { cursor: 4 },
    });
    expect(press(text, "b", { meta: true })).toMatchObject({
      state: { cursor: 4 },
    });
    expect(press({ ...text, cursor: 0 }, "f", { meta: true })).toMatchObject({
      state: { cursor: 3 },
    });
  });

  test("Backspace, Delete, Ctrl+W and Ctrl+A/E edit and move as in a shell", () => {
    expect(press(hello, "", { backspace: true })).toMatchObject({
      state: { text: "hell" },
    });
    expect(press({ ...hello, cursor: 0 }, "", { delete: true })).toMatchObject({
      state: { text: "ello" },
    });
    expect(
      press({ text: "one two", cursor: 7 }, "w", { ctrl: true }),
    ).toMatchObject({
      state: { text: "one " },
    });
    expect(press(hello, "a", { ctrl: true })).toMatchObject({
      state: { cursor: 0 },
    });
    expect(press({ ...hello, cursor: 0 }, "e", { ctrl: true })).toMatchObject({
      state: { cursor: 5 },
    });
  });

  test("other control and meta combinations type nothing", () => {
    expect(press(hello, "x", { ctrl: true })).toEqual({ kind: "ignore" });
    expect(press(hello, "x", { meta: true })).toEqual({ kind: "ignore" });
    expect(press(hello, "", { pageUp: true })).toEqual({ kind: "ignore" });
  });
});
