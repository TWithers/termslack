/**
 * Asks the terminal to report mouse buttons and the wheel (`?1000`), the
 * pointer moving with or without a button down (`?1003`), with coordinates as
 * plain numbers (`?1006`, SGR), as `ESC [ < b ; x ; y M` on stdin.
 */
export const mouseReportingOn = "\x1b[?1000h\x1b[?1003h\x1b[?1006h";
export const mouseReportingOff = "\x1b[?1006l\x1b[?1003l\x1b[?1000l";

export type MouseButton = "left" | "middle" | "right" | "none";

export type MouseKind =
  "press" | "release" | "motion" | "wheelUp" | "wheelDown";

/** One mouse report. `column` and `row` count from 0 at the screen's top left. */
export type MouseInput = {
  kind: MouseKind;
  /** Which button a press, release or motion is for; `none` for motion with no button down and for the wheel. */
  button: MouseButton;
  column: number;
  row: number;
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
};

const buttons: MouseButton[] = ["left", "middle", "right", "none"];

const shiftBit = 4;
const altBit = 8;
const ctrlBit = 16;
const motionBit = 32;
const wheelBit = 64;

/** A whole report: the button bits, then column and row (from 1), then `M` for press and motion or `m` for release. */
const mouseReport = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g;

/** The start of a report that the end of a chunk cuts off. A lone ESC or `ESC [` is not held back: those are keys. */
const unfinishedReport = /\x1b\[<[\d;]{0,16}$/;

/** What a report says, or undefined for one termslack has no use for (the horizontal wheel, extra buttons). */
export function decodeMouseReport(
  code: number,
  column: number,
  row: number,
  final: string,
): MouseInput | undefined {
  const modifiers = {
    shift: (code & shiftBit) !== 0,
    alt: (code & altBit) !== 0,
    ctrl: (code & ctrlBit) !== 0,
  };
  const position = { column: column - 1, row: row - 1 };

  if ((code & wheelBit) !== 0) {
    const wheel = code & 3;

    if (wheel > 1 || final !== "M") {
      return undefined;
    }

    return {
      kind: wheel === 0 ? "wheelUp" : "wheelDown",
      button: "none",
      ...position,
      ...modifiers,
    };
  }

  const button = buttons[code & 3]!;

  if ((code & motionBit) !== 0) {
    return { kind: "motion", button, ...position, ...modifiers };
  }

  return {
    kind: final === "M" ? "press" : "release",
    button,
    ...position,
    ...modifiers,
  };
}

/**
 * Takes the mouse reports out of terminal input chunk by chunk, telling
 * `onMouse` about each in order, and returns what is left, which is what the
 * user typed. A report cut off at the end of a chunk is held back and
 * completed by the next one; anything else that merely looks like a report
 * is passed through.
 */
export function createMouseReportFilter(
  onMouse: (input: MouseInput) => void,
): (chunk: string) => string {
  let held = "";

  return (chunk) => {
    const text = (held + chunk).replace(
      mouseReport,
      (_, code: string, column: string, row: string, final: string) => {
        const input = decodeMouseReport(
          Number(code),
          Number(column),
          Number(row),
          final,
        );

        if (input) {
          onMouse(input);
        }

        return "";
      },
    );
    const cut = unfinishedReport.exec(text);

    held = cut ? cut[0] : "";

    return cut ? text.slice(0, cut.index) : text;
  };
}

/**
 * Where mouse reports go: stdin's filter puts them in, the app listens. It
 * also says when the terminal lost focus, after which the pointer's last
 * position means nothing (no motion report follows when it leaves the window).
 */
export type MouseSource = {
  subscribe(listener: (input: MouseInput) => void): () => void;
  subscribeToBlur(listener: () => void): () => void;
};

export function createMouseSource(): MouseSource & {
  emit(input: MouseInput): void;
  blur(): void;
} {
  const listeners = new Set<(input: MouseInput) => void>();
  const blurListeners = new Set<() => void>();

  return {
    subscribe(listener) {
      listeners.add(listener);

      return () => void listeners.delete(listener);
    },
    subscribeToBlur(listener) {
      blurListeners.add(listener);

      return () => void blurListeners.delete(listener);
    },
    emit(input) {
      listeners.forEach((listener) => listener(input));
    },
    blur() {
      blurListeners.forEach((listener) => listener());
    },
  };
}
