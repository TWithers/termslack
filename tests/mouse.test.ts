import { expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { createMouseReportFilter, type MouseInput } from "../src/ui/app/mouse";
import { withoutFocusReports } from "../src/ui/app/terminalFocus";

function collect() {
  const inputs: MouseInput[] = [];

  return { inputs, filter: createMouseReportFilter((i) => inputs.push(i)) };
}

test("a left press and release are decoded with 0-based coordinates", () => {
  const { inputs, filter } = collect();

  expect(filter("\x1b[<0;12;5M\x1b[<0;12;5m")).toBe("");
  expect(inputs).toEqual([
    {
      kind: "press",
      button: "left",
      column: 11,
      row: 4,
      shift: false,
      alt: false,
      ctrl: false,
    },
    {
      kind: "release",
      button: "left",
      column: 11,
      row: 4,
      shift: false,
      alt: false,
      ctrl: false,
    },
  ]);
});

test("buttons, wheel, motion and modifier bits are understood", () => {
  const { inputs, filter } = collect();

  filter(
    "\x1b[<1;1;1M\x1b[<2;1;1M\x1b[<64;1;1M\x1b[<65;1;1M\x1b[<35;3;4M\x1b[<32;3;4M\x1b[<28;1;1M",
  );

  expect(inputs.map(({ kind, button }) => [kind, button])).toEqual([
    ["press", "middle"],
    ["press", "right"],
    ["wheelUp", "none"],
    ["wheelDown", "none"],
    ["motion", "none"],
    ["motion", "left"],
    ["press", "left"],
  ]);
  expect(inputs[6]).toMatchObject({ shift: true, alt: true, ctrl: true });
});

test("the horizontal wheel is taken out and ignored", () => {
  const { inputs, filter } = collect();

  expect(filter("a\x1b[<66;1;1Mb")).toBe("ab");
  expect(inputs).toEqual([]);
});

test("typed text around reports is kept in order", () => {
  const { inputs, filter } = collect();

  expect(filter("ab\x1b[<0;1;1Mcd\x1b[<0;2;2me")).toBe("abcde");
  expect(inputs).toHaveLength(2);
});

test("a report split across chunks is held until it is whole", () => {
  for (const cut of [3, 4, 6, 7, 9]) {
    const { inputs, filter } = collect();
    const report = "\x1b[<0;12;5M";

    expect(filter(`x${report.slice(0, cut)}`)).toBe("x");
    expect(inputs).toEqual([]);
    expect(filter(`${report.slice(cut)}y`)).toBe("y");
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toMatchObject({ column: 11, row: 4 });
  }
});

test("a lone escape and other escape sequences pass straight through", () => {
  const { inputs, filter } = collect();

  expect(filter("\x1b")).toBe("\x1b");
  expect(filter("\x1b[")).toBe("\x1b[");
  expect(filter("\x1b[A\x1b[1;5C\x1b[200~x\x1b[201~")).toBe(
    "\x1b[A\x1b[1;5C\x1b[200~x\x1b[201~",
  );
  expect(inputs).toEqual([]);
});

test("something that only looks like a report is passed through unchanged", () => {
  const { inputs, filter } = collect();

  for (const text of [
    "\x1b[<0;1M",
    "\x1b[<a;1;1M",
    "\x1b[<0;1;1X",
    "\x1b[<0;1;1;1M",
    "[<0;1;1M",
  ]) {
    expect(filter(text)).toBe(text);
  }

  expect(inputs).toEqual([]);
});

test("a held start that turns out not to be a report is let go with the next chunk", () => {
  const { inputs, filter } = collect();

  expect(filter("\x1b[<0;1")).toBe("");
  expect(filter("x")).toBe("\x1b[<0;1x");
  expect(inputs).toEqual([]);
});

test("a stream that ends a report in a later read still delivers it", () => {
  const stream = new PassThrough();
  const inputs: MouseInput[] = [];

  stream.setEncoding("utf8");

  const wrapped = withoutFocusReports(
    stream as unknown as NodeJS.ReadStream,
    () => {},
    (input) => inputs.push(input),
  );

  stream.write("a\x1b[<0;4;");
  expect(wrapped.read()).toBe("a");
  expect(wrapped.read()).toBeNull();

  stream.write("2M\x1b[Ib");
  expect(wrapped.read()).toBe("b");
  expect(inputs).toMatchObject([{ kind: "press", column: 3, row: 1 }]);
});

test("a lone escape key reaches the reader at once", () => {
  const stream = new PassThrough();

  stream.setEncoding("utf8");

  const wrapped = withoutFocusReports(
    stream as unknown as NodeJS.ReadStream,
    () => {},
  );

  stream.write("\x1b");
  expect(wrapped.read()).toBe("\x1b");
});
