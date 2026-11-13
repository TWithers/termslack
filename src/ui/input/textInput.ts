/*
 * The text and cursor model behind termslack's input boxes, as pure functions:
 * every edit takes a state and returns the next one. The Ink component and
 * the key bindings sit on top (see `inputKeys.ts`, `InputBox.tsx`), so the
 * message input, a thread input and the edit mode all share one model and
 * all of it is testable without a terminal.
 */

import { cellWidth } from "../terminalSafeText";

/**
 * What is typed and where the cursor is. `cursor` is an index into `text`
 * (UTF-16 units) and always sits between two characters as the user sees
 * them, never inside an emoji or an accent.
 */
export type InputState = {
  text: string;
  cursor: number;
};

export const emptyInput: InputState = { text: "", cursor: 0 };

/** `text` with the cursor at its end, as when a draft is restored. */
export function inputOf(text: string): InputState {
  return { text, cursor: text.length };
}

/** Whether there is nothing worth sending. */
export function isBlank(text: string): boolean {
  return text.trim() === "";
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** The characters of `text` as the user sees them. */
function characters(text: string): string[] {
  return [...graphemes.segment(text)].map(({ segment }) => segment);
}

function previousBoundary(text: string, cursor: number): number {
  let boundary = 0;

  for (const { index } of graphemes.segment(text)) {
    if (index >= cursor) {
      break;
    }

    boundary = index;
  }

  return boundary;
}

function nextBoundary(text: string, cursor: number): number {
  for (const { index, segment } of graphemes.segment(text)) {
    if (index >= cursor) {
      return index + segment.length;
    }
  }

  return text.length;
}

/** Newlines are `\n`, other control characters are dropped and a tab becomes spaces. */
function cleaned(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, "    ")
    .replace(/[\p{Cc}]/gu, (character) => (character === "\n" ? "\n" : ""));
}

/** Types or pastes `inserted` at the cursor. */
export function insertText(state: InputState, inserted: string): InputState {
  const text = cleaned(inserted);

  return {
    text:
      state.text.slice(0, state.cursor) + text + state.text.slice(state.cursor),
    cursor: state.cursor + text.length,
  };
}

export function deleteBack(state: InputState): InputState {
  const from = previousBoundary(state.text, state.cursor);

  return {
    text: state.text.slice(0, from) + state.text.slice(state.cursor),
    cursor: from,
  };
}

export function deleteForward(state: InputState): InputState {
  const to = nextBoundary(state.text, state.cursor);

  return {
    ...state,
    text: state.text.slice(0, state.cursor) + state.text.slice(to),
  };
}

/** Deletes back to the start of the word before the cursor (and the spaces between). */
export function deleteWordBack(state: InputState): InputState {
  const from = wordLeft(state).cursor;

  return {
    text: state.text.slice(0, from) + state.text.slice(state.cursor),
    cursor: from,
  };
}

export function moveLeft(state: InputState): InputState {
  return { ...state, cursor: previousBoundary(state.text, state.cursor) };
}

export function moveRight(state: InputState): InputState {
  return { ...state, cursor: nextBoundary(state.text, state.cursor) };
}

function isSpace(character: string | undefined): boolean {
  return character !== undefined && /^\s$/.test(character);
}

/** To the start of the word before the cursor. Spaces and newlines separate words. */
export function wordLeft(state: InputState): InputState {
  let cursor = state.cursor;

  while (cursor > 0 && isSpace(state.text[cursor - 1])) {
    cursor--;
  }

  while (cursor > 0 && !isSpace(state.text[cursor - 1])) {
    cursor--;
  }

  return { ...state, cursor };
}

/** To the end of the word after the cursor. */
export function wordRight(state: InputState): InputState {
  let cursor = state.cursor;

  while (cursor < state.text.length && isSpace(state.text[cursor])) {
    cursor++;
  }

  while (cursor < state.text.length && !isSpace(state.text[cursor])) {
    cursor++;
  }

  return { ...state, cursor };
}

function startOfLine(text: string, cursor: number): number {
  return text.lastIndexOf("\n", cursor - 1) + 1;
}

function endOfLine(text: string, cursor: number): number {
  const end = text.indexOf("\n", cursor);

  return end < 0 ? text.length : end;
}

export function lineStart(state: InputState): InputState {
  return { ...state, cursor: startOfLine(state.text, state.cursor) };
}

export function lineEnd(state: InputState): InputState {
  return { ...state, cursor: endOfLine(state.text, state.cursor) };
}

/** How many characters are before the cursor on its line. */
function column(state: InputState): number {
  return characters(
    state.text.slice(startOfLine(state.text, state.cursor), state.cursor),
  ).length;
}

/** The cursor `column` characters into the line starting at `start` (or at its end if shorter). */
function cursorAt(text: string, start: number, wanted: number): number {
  const line = text.slice(start, endOfLine(text, start));

  return start + characters(line).slice(0, wanted).join("").length;
}

/**
 * Up and down move between the lines the user typed (separated by newlines),
 * not between wrapped screen lines. On the first line, up goes to its start
 * and down on the last goes to its end, so the keys never feel dead.
 */
export function lineUp(state: InputState): InputState {
  const start = startOfLine(state.text, state.cursor);

  if (start === 0) {
    return { ...state, cursor: 0 };
  }

  const previousStart = startOfLine(state.text, start - 1);

  return {
    ...state,
    cursor: cursorAt(state.text, previousStart, column(state)),
  };
}

export function lineDown(state: InputState): InputState {
  const end = endOfLine(state.text, state.cursor);

  if (end === state.text.length) {
    return { ...state, cursor: end };
  }

  return { ...state, cursor: cursorAt(state.text, end + 1, column(state)) };
}

/** An input as drawn: the lines in view and where the cursor is among them. */
export type InputLayout = {
  /** The visible lines, at most the limit asked for. */
  lines: string[];
  /** The cursor within `lines`: the row, and the UTF-16 offset into that line's text. */
  cursor: { row: number; offset: number };
};

type Chunk = { text: string; start: number };

/** Splits one line of text into pieces of at most `width` cells; always at least one. */
function wrapLine(line: string, width: number): Chunk[] {
  const chunks: Chunk[] = [{ text: "", start: 0 }];
  let used = 0;
  let position = 0;

  for (const character of characters(line)) {
    const cells = cellWidth(character);

    if (used + cells > width && chunks.at(-1)!.text !== "") {
      chunks.push({ text: "", start: position });
      used = 0;
    }

    chunks.at(-1)!.text += character;
    used += cells;
    position += character.length;
  }

  return chunks;
}

/**
 * Wraps the text to `width` cells and picks the `maxLines` lines to show:
 * the first ones, moving down only as far as needed to keep the cursor in
 * view. A cursor at the end of a line that exactly fills the width is on a
 * fresh empty line, where the next character will go.
 */
export function layoutInput(
  { text, cursor }: InputState,
  width: number,
  maxLines: number,
): InputLayout {
  const lines: string[] = [];
  let cursorRow = 0;
  let cursorOffset = 0;
  let lineBegin = 0;

  for (const line of text.split("\n")) {
    const chunks = wrapLine(line, Math.max(1, width));
    const lineCursor = cursor - lineBegin;
    const lastChunk = chunks.at(-1)!;

    if (
      lineCursor === line.length &&
      cellWidth(lastChunk.text) >= width &&
      lastChunk.text !== ""
    ) {
      chunks.push({ text: "", start: line.length });
    }

    chunks.forEach((chunk, index) => {
      const end = chunk.start + chunk.text.length;
      const isLast = index === chunks.length - 1;

      if (
        lineCursor >= chunk.start &&
        (lineCursor < end || (isLast && lineCursor <= end))
      ) {
        cursorRow = lines.length;
        cursorOffset = lineCursor - chunk.start;
      }

      lines.push(chunk.text);
    });

    lineBegin += line.length + 1;
  }

  const top = Math.max(0, cursorRow - maxLines + 1);

  return {
    lines: lines.slice(top, top + maxLines),
    cursor: { row: cursorRow - top, offset: cursorOffset },
  };
}
