/** Asks the terminal what OSC 99 notifications it supports, then for its version (XTVERSION), then for its attributes (DA1), which every terminal answers. */
export const terminalProbe =
  "\x1b]99;i=termslack-probe:p=?;\x1b\\\x1b[>0q\x1b[c";

/** What a terminal said back to a question termslack asked it. */
export type TerminalAnswer =
  | { kind: "osc99"; capabilities: Record<string, string[]> }
  | { kind: "xtversion"; name: string }
  | { kind: "da1" }
  | { kind: "notificationClick"; identifier: string };

/** The answers to the probe's questions. */
export type ProbeAnswer = Exclude<
  TerminalAnswer,
  { kind: "notificationClick" }
>;

/** What the probe worked out about the terminal. */
export type ProbeResult = {
  name?: string;
  osc99?: Record<string, string[]>;
};

const xtversionAnswer = /\x1bP>\|([^\x07\x1b]*)(?:\x1b\\|\x07)/g;
const da1Answer = /\x1b\[\?[\d;]*c/g;
const osc99Answer =
  /\x1b\]99;i=termslack-probe:p=\?;([^\x07\x1b]*)(?:\x1b\\|\x07)/g;
/**
 * kitty's report of a click on a notification: `ESC ] 99 ; i=<id> ; ST`, with
 * a button number before the ST for a click on a button (none are sent, so a
 * numbered report counts as a click on the body).
 */
const osc99Click = /\x1b\]99;i=([^:;\x07\x1b]+);\d*(?:\x1b\\|\x07)/g;
const answer = new RegExp(
  `${xtversionAnswer.source}|${da1Answer.source}|${osc99Answer.source}|${osc99Click.source}`,
  "g",
);
const unfinishedAnswer =
  /\x1bP>(?:\|[^\x07\x1b]*\x1b?)?$|\x1b\[\?[\d;]*$|\x1b\]99;[^\x07\x1b]*\x1b?$/;
const unfinishedAnswerWhileProbing = new RegExp(
  `${unfinishedAnswer.source}|\\x1b(?:P|\\[|\\]9?9?)?$`,
);

/** `key=value:key=value` with comma-separated values; malformed pairs are skipped. */
function parseCapabilities(pairs: string): Record<string, string[]> {
  const capabilities: Record<string, string[]> = {};

  for (const pair of pairs.split(":")) {
    const separator = pair.indexOf("=");

    if (separator < 1) {
      continue;
    }

    capabilities[pair.slice(0, separator)] = pair
      .slice(separator + 1)
      .split(",")
      .filter((value) => value !== "");
  }

  return capabilities;
}

/**
 * Takes the terminal's answers out of its input, telling `onAnswer` about
 * each in order; what is left is what the user typed, unchanged. An answer
 * split across chunks is held until it is whole. Only a tail that can't be
 * typed (`ESC P >`, `ESC [ ?`, `ESC ] 99 ;`) is held, so a lone Escape key
 * never waits, except while `isProbing` says the probe is still waiting for
 * its answers: then any start of an answer (`ESC`, `ESC P`, `ESC ]`...) is
 * held too. A tail held that turned out not to be an answer comes out with
 * the next chunk.
 */
export function createTerminalAnswerFilter(
  onAnswer: (answer: TerminalAnswer) => void,
  isProbing: () => boolean = () => false,
): (chunk: string) => string {
  let held = "";

  return (chunk) => {
    const text = (held + chunk).replace(
      answer,
      (
        match,
        name: string | undefined,
        pairs: string | undefined,
        clicked: string | undefined,
      ) => {
        if (clicked !== undefined) {
          onAnswer({ kind: "notificationClick", identifier: clicked });
        } else if (match.startsWith("\x1b]")) {
          onAnswer({
            kind: "osc99",
            capabilities: parseCapabilities(pairs ?? ""),
          });
        } else if (match.startsWith("\x1bP")) {
          onAnswer({ kind: "xtversion", name: name ?? "" });
        } else {
          onAnswer({ kind: "da1" });
        }

        return "";
      },
    );
    const cut = (
      isProbing() ? unfinishedAnswerWhileProbing : unfinishedAnswer
    ).exec(text);

    held = cut ? cut[0] : "";

    return cut ? text.slice(0, cut.index) : text;
  };
}

/**
 * Works out what the terminal is from its answers to `terminalProbe`. It is
 * done when DA1 arrives (XTVERSION, if answered, came first) or after
 * `timeoutMs`, and `onDone` hears what was found (the name, the OSC 99 capabilities) exactly once.
 * `stop` makes it finish silently.
 */
export function createTerminalProbe(
  timeoutMs: number,
  onDone: (result: ProbeResult) => void,
) {
  const result: ProbeResult = {};
  let finished = false;
  const timer = setTimeout(() => finish(), timeoutMs);

  function finish() {
    if (finished) {
      return;
    }

    finished = true;
    clearTimeout(timer);
    onDone(result);
  }

  return {
    /** Whether it is still waiting for answers. */
    get running() {
      return !finished;
    },
    answer(received: ProbeAnswer) {
      if (finished) {
        return;
      }

      if (received.kind === "osc99") {
        result.osc99 = received.capabilities;

        return;
      }

      if (received.kind === "xtversion") {
        result.name = received.name;

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
