import { describe, expect, test } from "bun:test";
import {
  deleteBack,
  deleteForward,
  deleteWordBack,
  emptyInput,
  inputOf,
  insertText,
  isBlank,
  layoutInput,
  lineDown,
  lineEnd,
  lineStart,
  lineUp,
  moveLeft,
  moveRight,
  wordLeft,
  wordRight,
  type InputState,
} from "../src/ui/input/textInput";

/** `text` with the cursor where `|` is. */
function at(marked: string): InputState {
  const cursor = marked.indexOf("|");

  return { text: marked.replace("|", ""), cursor };
}

/** The state as a string with `|` at the cursor, for readable assertions. */
function shown({ text, cursor }: InputState): string {
  return `${text.slice(0, cursor)}|${text.slice(cursor)}`;
}

describe("editing", () => {
  test("inserting puts text at the cursor and moves the cursor after it", () => {
    expect(shown(insertText(at("he|llo"), "XY"))).toBe("heXY|llo");
    expect(shown(insertText(emptyInput, "hi"))).toBe("hi|");
  });

  test("inserted newlines are normalised and control characters dropped", () => {
    expect(insertText(emptyInput, "a\r\nb\rc\x1b[0m").text).toBe("a\nb\nc[0m");
    expect(insertText(emptyInput, "a\tb").text).toBe("a    b");
  });

  test("backspace and delete remove a whole character, even a multi-unit emoji", () => {
    expect(shown(deleteBack(at("ab|c")))).toBe("a|c");
    expect(shown(deleteBack(at("a👍🏽|b")))).toBe("a|b");
    expect(shown(deleteForward(at("a|👍🏽b")))).toBe("a|b");
    expect(shown(deleteBack(at("|abc")))).toBe("|abc");
    expect(shown(deleteForward(at("abc|")))).toBe("abc|");
  });

  test("deleting a word back removes the spaces before it and the word", () => {
    expect(shown(deleteWordBack(at("one two  |")))).toBe("one |");
    expect(shown(deleteWordBack(at("one tw|o")))).toBe("one |o");
  });

  test("blank means nothing but whitespace", () => {
    expect(isBlank("")).toBe(true);
    expect(isBlank(" \n\t ")).toBe(true);
    expect(isBlank(" a ")).toBe(false);
  });

  test("inputOf puts the cursor at the end", () => {
    expect(shown(inputOf("abc"))).toBe("abc|");
  });
});

describe("moving", () => {
  test("left and right step over whole characters and stop at the ends", () => {
    expect(shown(moveLeft(at("a👍🏽|")))).toBe("a|👍🏽");
    expect(shown(moveRight(at("|a👍🏽")))).toBe("a|👍🏽");
    expect(shown(moveLeft(at("|a")))).toBe("|a");
    expect(shown(moveRight(at("a|")))).toBe("a|");
  });

  test("home and end go to the ends of the current line", () => {
    expect(shown(lineStart(at("one\ntw|o\nthree")))).toBe("one\n|two\nthree");
    expect(shown(lineEnd(at("one\ntw|o\nthree")))).toBe("one\ntwo|\nthree");
  });

  test("word movement skips spaces and newlines", () => {
    expect(shown(wordLeft(at("one two|")))).toBe("one |two");
    expect(shown(wordLeft(at("one  |two")))).toBe("|one  two");
    expect(shown(wordRight(at("|one two")))).toBe("one| two");
    expect(shown(wordRight(at("one| \n two")))).toBe("one \n two|");
  });

  test("up and down keep the column, clamped to shorter lines", () => {
    expect(shown(lineUp(at("abcd\nab|")))).toBe("ab|cd\nab");
    expect(shown(lineUp(at("ab\nabcd|")))).toBe("ab|\nabcd");
    expect(shown(lineDown(at("ab|cd\nxy")))).toBe("abcd\nxy|");
    expect(shown(lineUp(at("ab|")))).toBe("|ab");
    expect(shown(lineDown(at("a|b")))).toBe("ab|");
  });
});

describe("layout", () => {
  test("short text is one line with the cursor in it", () => {
    const layout = layoutInput(at("hel|lo"), 10, 5);

    expect(layout.lines).toEqual(["hello"]);
    expect(layout.cursor).toEqual({ row: 0, offset: 3 });
  });

  test("long lines wrap at the width and newlines start new lines", () => {
    const layout = layoutInput(at("abcdefg\nhi|"), 3, 10);

    expect(layout.lines).toEqual(["abc", "def", "g", "hi"]);
    expect(layout.cursor).toEqual({ row: 3, offset: 2 });
  });

  test("a cursor at the end of a full line sits on the next row", () => {
    const layout = layoutInput(at("abc|"), 3, 10);

    expect(layout.lines).toEqual(["abc", ""]);
    expect(layout.cursor).toEqual({ row: 1, offset: 0 });
  });

  test("wide characters count for two cells", () => {
    const layout = layoutInput(at("日本語|"), 4, 10);

    expect(layout.lines).toEqual(["日本", "語"]);
    expect(layout.cursor).toEqual({ row: 1, offset: 1 });
  });

  test("only the last lines up to the limit show, scrolled to keep the cursor in view", () => {
    const text = "1\n2\n3\n4\n5\n6";

    expect(layoutInput({ text, cursor: text.length }, 10, 3).lines).toEqual([
      "4",
      "5",
      "6",
    ]);
    expect(layoutInput({ text, cursor: 0 }, 10, 3)).toMatchObject({
      lines: ["1", "2", "3"],
      cursor: { row: 0, offset: 0 },
    });
  });

  test("empty input is one empty line", () => {
    expect(layoutInput(emptyInput, 10, 3).lines).toEqual([""]);
  });
});
