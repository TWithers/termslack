import { expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import {
  stripFocusReports,
  withoutFocusReports,
} from "../src/ui/app/terminalFocus";

test("focus reports are reported in order and taken out of the input", () => {
  const changes: boolean[] = [];

  expect(
    stripFocusReports("a\x1b[Ib\x1b[O\x1b[Ic", (focused) =>
      changes.push(focused),
    ),
  ).toBe("abc");
  expect(changes).toEqual([true, false, true]);
});

test("other escape sequences and typed brackets are left alone", () => {
  const changes: boolean[] = [];
  const input = "[I [O \x1b[A \x1b[1;5I \x1b[200~x\x1b[201~";

  expect(stripFocusReports(input, (focused) => changes.push(focused))).toBe(
    input,
  );
  expect(changes).toEqual([]);
});

test("a stream wrapped to hide focus reports reads everything else as usual", () => {
  const stream = new PassThrough();
  const changes: boolean[] = [];

  stream.setEncoding("utf8");

  const wrapped = withoutFocusReports(
    stream as unknown as NodeJS.ReadStream,
    (focused) => changes.push(focused),
  );

  stream.write("\x1b[I");
  stream.write("x\x1b[Oy");

  expect(wrapped.read()).toBe("xy");
  expect(wrapped.read()).toBeNull();
  expect(changes).toEqual([true, false]);
});
