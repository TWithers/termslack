/** Asks the terminal for its version (XTVERSION), then for its attributes (DA1), which every terminal answers. */
export const terminalProbe = "\x1b[>0q\x1b[c";

/** What a terminal said back to a question termslack asked it. */
export type TerminalAnswer =
  { kind: "xtversion"; name: string } | { kind: "da1" };

const xtversionAnswer = /\x1bP>\|([^\x07\x1b]*)(?:\x1b\\|\x07)/g;
const da1Answer = /\x1b\[\?[\d;]*c/g;
const answer = new RegExp(`${xtversionAnswer.source}|${da1Answer.source}`, "g");
const unfinishedAnswer = /\x1bP>(?:\|[^\x07\x1b]*\x1b?)?$|\x1b\[\?[\d;]*$/;

/**
 * Takes the terminal's answers out of its input, telling `onAnswer` about
 * each in order; what is left is what the user typed, unchanged. An answer
 * split across chunks is held until it is whole. Only a tail that can't be
 * typed (`ESC P >`, `ESC [ ?`) is held, so a lone Escape key never waits.
 */
export function createTerminalAnswerFilter(
  onAnswer: (answer: TerminalAnswer) => void,
): (chunk: string) => string {
  let held = "";

  return (chunk) => {
    const text = (held + chunk).replace(
      answer,
      (match, name: string | undefined) => {
        onAnswer(
          match.startsWith("\x1bP")
            ? { kind: "xtversion", name: name ?? "" }
            : { kind: "da1" },
        );

        return "";
      },
    );
    const cut = unfinishedAnswer.exec(text);

    held = cut ? cut[0] : "";

    return cut ? text.slice(0, cut.index) : text;
  };
}

/**
 * Works out what the terminal is from its answers to `terminalProbe`. It is
 * done when DA1 arrives (XTVERSION, if answered, came first) or after
 * `timeoutMs`, and `onDone` hears the name found, if any, exactly once.
 * `stop` makes it finish silently.
 */
export function createTerminalProbe(
  timeoutMs: number,
  onDone: (name: string | undefined) => void,
) {
  let name: string | undefined;
  let finished = false;
  const timer = setTimeout(() => finish(), timeoutMs);

  function finish() {
    if (finished) {
      return;
    }

    finished = true;
    clearTimeout(timer);
    onDone(name);
  }

  return {
    answer(received: TerminalAnswer) {
      if (finished) {
        return;
      }

      if (received.kind === "xtversion") {
        name = received.name;

        return;
      }

      finish();
    },
    stop() {
      finished = true;
      clearTimeout(timer);
    },
  };
}
