import { PassThrough } from "node:stream";

/** Streams that look like a terminal, and record what termslack does to it. */
export function fakeTerminal() {
  const written: string[] = [];
  const rawModes: boolean[] = [];

  const stdout = Object.assign(new PassThrough(), {
    columns: 100,
    rows: 30,
    isTTY: true,
  });
  const stdin = Object.assign(new PassThrough(), {
    isTTY: true,
    setRawMode: (enabled: boolean) => {
      rawModes.push(enabled);

      return stdin;
    },
    ref: () => stdin,
    unref: () => stdin,
  });

  stdout.on("data", (chunk) => written.push(String(chunk)));

  return {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin,
    written: () => written.join(""),
    rawModes,
  };
}
