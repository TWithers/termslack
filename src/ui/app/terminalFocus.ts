import { createMouseReportFilter, type MouseInput } from "./mouse";
import {
  createTerminalAnswerFilter,
  type TerminalAnswer,
} from "./terminalAnswers";

/** Asks the terminal to report when its window gains or loses focus, as `ESC [ I` and `ESC [ O` on stdin. */
export const focusReportingOn = "\x1b[?1004h";
export const focusReportingOff = "\x1b[?1004l";

export const ringBell = "\x07";

const focusReport = /\x1b\[([IO])/g;

/**
 * Takes the focus reports out of a chunk of terminal input, telling
 * `onChange` about each in order. What is left is what the user typed.
 * (A report split across two chunks isn't recognised; terminals send it whole.)
 */
export function stripFocusReports(
  input: string,
  onChange: (focused: boolean) => void,
): string {
  return input.replace(focusReport, (_, code: string) => {
    onChange(code === "I");

    return "";
  });
}

/**
 * Stdin as Ink should see it: the same stream, but its focus reports and
 * mouse reports are handled here (the mouse's by `onMouse`), so they can't
 * reach a key handler or the input box. (Ink drops them too, but without
 * saying they happened.) The terminal's answers to its probe go to `onAnswer`.
 */
export function withoutFocusReports<T extends NodeJS.ReadableStream>(
  stdin: T,
  onChange: (focused: boolean) => void,
  onMouse: (input: MouseInput) => void = () => {},
  onAnswer: (answer: TerminalAnswer) => void = () => {},
): T {
  const stripAnswers = createTerminalAnswerFilter(onAnswer);
  const stripMouseReports = createMouseReportFilter(onMouse);

  return new Proxy(stdin, {
    get(target, property) {
      if (property === "read") {
        return (...args: unknown[]) => {
          let chunk: unknown;

          while (
            (chunk = (target.read as (...args: unknown[]) => unknown)(
              ...args,
            )) !== null
          ) {
            const text = stripFocusReports(
              stripMouseReports(stripAnswers(String(chunk))),
              onChange,
            );

            if (text !== "") {
              return text;
            }
          }

          return null;
        };
      }

      const value = Reflect.get(target, property, target);

      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
