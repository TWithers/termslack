import { cellWidth, terminalSafeText } from "./terminalSafeText";

/**
 * What a label may say, longest first: a plain string, or the same label in
 * shorter forms that are tried in order when the longer ones do not fit.
 */
export type BorderLabel = string | readonly string[];

/** The four places on a box's border a label can go. */
export type BorderLabels = {
  topLeft?: BorderLabel;
  topRight?: BorderLabel;
  bottomLeft?: BorderLabel;
  bottomRight?: BorderLabel;
};

/** The labels that fit, each as the text to draw (inside its space on each side). */
export type FittedBorderLabels = {
  topLeft?: string;
  topRight?: string;
  bottomLeft?: string;
  bottomRight?: string;
};

const separator = " · ";
const ellipsis = "…";

/** Columns spent beside a label's text: a space and a kept dash on each side. */
const labelFrame = 4;

/** Columns a second label adds around its text: a space on each side. */
const secondLabelFrame = 2;

/** Columns that must stay between a left and a right label. */
const minimumGap = 1;

/**
 * The columns of text a lone label may have on a border `width` columns wide
 * (between the corners): one dash is kept beside each corner, and the label
 * has a space before and after its text.
 */
export function borderLabelRoom(width: number): number {
  return Math.max(0, width - labelFrame);
}

/**
 * Key hints `text` ("j/k move · Enter open · Esc close") in the forms that
 * `fitBorderLabels` tries, longest first: every key, then without the keys
 * between the first and the last, one fewer at a time, ending with the last
 * key alone (the one that gets you out).
 */
export function keyVariants(text: string): string[] {
  const keys = text.split(separator);
  const last = keys.at(-1)!;
  const variants: string[] = [];

  for (let kept = keys.length - 1; kept >= 0; kept--) {
    variants.push([...keys.slice(0, kept), last].join(separator));
  }

  return variants;
}

const segmenter = new Intl.Segmenter();

/** A piece of key hints: a key, or the words around the keys. */
export type KeyHintRun = { text: string; key: boolean };

const noteDash = " — ";

/** Whether a hint's word names a key: a single character ("?", "M"), a chord or choice ("Ctrl+T", "j/k"), or a capitalised name ("Enter", "PgUp"). */
function isKey(word: string | undefined): boolean {
  if (!word) {
    return false;
  }

  if ([...segmenter.segment(word)].length === 1) {
    return true;
  }

  return /[/+]/.test(word) || /^\p{Lu}/u.test(word);
}

/** One hint ("Esc or ? close") as runs: its leading keys, joined by "or", then what they do. */
function hintRuns(hint: string): KeyHintRun[] {
  const dash = hint.indexOf(noteDash);

  if (dash >= 0) {
    const note = hint.slice(0, dash + noteDash.length);

    return [{ text: note, key: false }, ...hintRuns(hint.slice(note.length))];
  }

  const words = hint.split(" ");

  if (!isKey(words[0])) {
    return [{ text: hint, key: false }];
  }

  const runs: KeyHintRun[] = [{ text: words[0]!, key: true }];
  let at = 1;

  while (words[at] === "or" && isKey(words[at + 1])) {
    runs.push(
      { text: " or ", key: false },
      { text: words[at + 1]!, key: true },
    );
    at += 2;
  }

  const rest = words.slice(at).join(" ");

  return rest === "" ? runs : [...runs, { text: ` ${rest}`, key: false }];
}

/**
 * Key hints as `keyVariants` makes them ("j/k move · Esc close") split into
 * the keys and the words around them, so the keys can be drawn in their own
 * colour. Joined, the runs are `text` again.
 */
export function keyHintRuns(text: string): KeyHintRun[] {
  const runs = text
    .split(separator)
    .flatMap((hint, index) =>
      index === 0
        ? hintRuns(hint)
        : [{ text: separator, key: false }, ...hintRuns(hint)],
    );

  return runs.reduce<KeyHintRun[]>((merged, run) => {
    const last = merged.at(-1);

    if (last && !last.key && !run.key) {
      last.text += run.text;

      return merged;
    }

    merged.push({ ...run });

    return merged;
  }, []);
}

/**
 * `text` in the forms that `fitBorderLabels` tries when its ending must
 * survive ("Leave #general? y/n", ending "? y/n"): whole, then with the
 * middle of what comes before the ending cut away with an ellipsis, a
 * character at a time ("Leave #gene…? y/n"), down to one character kept.
 * Text that does not end with `ending` is returned as it is.
 */
export function keepEndingVariants(text: string, ending: string): string[] {
  if (!text.endsWith(ending) || text === ending) {
    return [text];
  }

  const head = [...segmenter.segment(text.slice(0, -ending.length))].map(
    ({ segment }) => segment,
  );
  const variants = [text];

  for (let kept = head.length - 1; kept >= 1; kept--) {
    variants.push(
      `${head.slice(0, kept).join("").trimEnd()}${ellipsis}${ending}`,
    );
  }

  return variants;
}

/** `text` cut to at most `room` cells, ending in an ellipsis when something was cut; a wide character is never split. */
function cut(text: string, room: number): string {
  if (cellWidth(text) <= room) {
    return text;
  }

  let kept = "";

  for (const { segment } of segmenter.segment(text)) {
    if (cellWidth(kept + segment) > room - cellWidth(ellipsis)) {
      break;
    }

    kept += segment;
  }

  return `${kept.trimEnd()}${ellipsis}`;
}

function variantsOf(label: BorderLabel | undefined): string[] {
  if (label === undefined) {
    return [];
  }

  return (typeof label === "string" ? [label] : [...label])
    .map(terminalSafeText)
    .filter((text) => text !== "");
}

/** The longest form of `label` that fits `room` whole, if any. */
function longestFit(variants: string[], room: number): string | undefined {
  return variants.find((text) => cellWidth(text) <= room);
}

function fitRow(
  width: number,
  left: BorderLabel | undefined,
  right: BorderLabel | undefined,
): { left?: string; right?: string } {
  const lefts = variantsOf(left);
  const rights = variantsOf(right);
  const room = borderLabelRoom(width);

  if (lefts.length === 0) {
    const fitted = longestFit(rights, room);

    return fitted === undefined ? {} : { right: fitted };
  }

  const together = room - secondLabelFrame - minimumGap;
  const first = lefts[0]!;
  const rightFit = longestFit(rights, together - cellWidth(first));

  if (rightFit !== undefined) {
    return { left: first, right: rightFit };
  }

  const fitted = longestFit(lefts, room);

  if (fitted !== undefined) {
    return { left: fitted };
  }

  if (room < 1) {
    return {};
  }

  return { left: cut(lefts.at(-1)!, room) };
}

/**
 * Decides what a box's border can show. `width` is the border's inner width
 * (the columns between the corners); each row is worked out on its own, so
 * the top labels never affect the bottom ones. Per row: the right-hand label
 * goes first, then the left label takes its shorter forms (the keys), and
 * what is left is cut with an ellipsis, so a left label stays as long as
 * there is room for one character. A label on its own that does not fit
 * shortens, then goes. Widths are cells, so wide characters count two, and
 * text is first made terminal safe, as it is drawn.
 */
export function fitBorderLabels(
  width: number,
  labels: BorderLabels,
): FittedBorderLabels {
  const top = fitRow(width, labels.topLeft, labels.topRight);
  const bottom = fitRow(width, labels.bottomLeft, labels.bottomRight);

  return {
    ...(top.left === undefined ? {} : { topLeft: top.left }),
    ...(top.right === undefined ? {} : { topRight: top.right }),
    ...(bottom.left === undefined ? {} : { bottomLeft: bottom.left }),
    ...(bottom.right === undefined ? {} : { bottomRight: bottom.right }),
  };
}
