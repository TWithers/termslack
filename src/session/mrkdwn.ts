import type { ContentBlock, Span, TextStyle } from "./content";

type Atom = { text: string; entity: boolean };

const markerStyles: Record<string, keyof TextStyle> = {
  "*": "bold",
  _: "italic",
  "~": "strike",
};

/** Characters, with each `<...>` entity as one opaque atom so formatting never reaches inside it. */
function atomize(line: string): Atom[] {
  const atoms: Atom[] = [];
  let position = 0;

  while (position < line.length) {
    const entity = /^<[^<>]*>/.exec(line.slice(position));

    if (entity) {
      atoms.push({ text: entity[0], entity: true });
      position += entity[0].length;
      continue;
    }

    const character = String.fromCodePoint(line.codePointAt(position)!);

    atoms.push({ text: character, entity: false });
    position += character.length;
  }

  return atoms;
}

const isWord = (atom?: Atom) =>
  !!atom && !atom.entity && /[\p{L}\p{N}]/u.test(atom.text);
const isSpace = (atom?: Atom) =>
  !atom || (!atom.entity && /\s/.test(atom.text));

/**
 * Formats one line the way Slack does: a marker opens at the start or after a
 * non-word character and needs non-space after it; it closes before non-space
 * and at the end or before a non-word character. Backtick spans are code and
 * hold no formatting. Unclosed markers stay literal.
 */
function parseLine(line: string): Span[] {
  const atoms = atomize(line);
  const codeEnds = new Map<number, number>();
  const inCode = new Set<number>();

  for (let i = 0; i < atoms.length; i++) {
    if (atoms[i]!.text !== "`" || atoms[i]!.entity) {
      continue;
    }

    const close = atoms.findIndex(
      (atom, index) => index > i + 1 && !atom.entity && atom.text === "`",
    );

    if (close === -1) {
      continue;
    }

    codeEnds.set(i, close);

    for (let k = i; k <= close; k++) {
      inCode.add(k);
    }

    i = close;
  }

  const canOpen = (i: number, marker: string) =>
    !isWord(atoms[i - 1]) &&
    atoms[i - 1]?.text !== marker &&
    !isSpace(atoms[i + 1]) &&
    atoms[i + 1]?.text !== marker;
  const canClose = (j: number, marker: string) =>
    !isSpace(atoms[j - 1]) &&
    atoms[j - 1]?.text !== marker &&
    !isWord(atoms[j + 1]) &&
    atoms[j + 1]?.text !== marker;

  function parseRange(from: number, to: number, style: TextStyle): Span[] {
    const spans: Span[] = [];
    let buffer = "";

    const flush = () => {
      if (buffer !== "") {
        spans.push(
          Object.keys(style).length > 0
            ? { markup: buffer, style }
            : { markup: buffer },
        );
        buffer = "";
      }
    };

    for (let i = from; i < to; i++) {
      const atom = atoms[i]!;
      const codeEnd = codeEnds.get(i);

      if (codeEnd !== undefined) {
        flush();
        spans.push({
          markup: atoms
            .slice(i + 1, codeEnd)
            .map((inner) => inner.text)
            .join(""),
          style: { ...style, code: true },
        });
        i = codeEnd;
        continue;
      }

      const flag = atom.entity ? undefined : markerStyles[atom.text];

      if (flag && !inCode.has(i) && canOpen(i, atom.text)) {
        let close = -1;

        for (let j = i + 2; j < to; j++) {
          if (
            atoms[j]!.text === atom.text &&
            !atoms[j]!.entity &&
            !inCode.has(j) &&
            canClose(j, atom.text)
          ) {
            close = j;
            break;
          }
        }

        if (close !== -1) {
          flush();
          spans.push(...parseRange(i + 1, close, { ...style, [flag]: true }));
          i = close;
          continue;
        }
      }

      buffer += atom.text;
    }

    flush();

    return spans;
  }

  return parseRange(0, atoms.length, {});
}

function joinLines(lines: string[]): Span[] {
  return lines.flatMap((line, index): Span[] => [
    ...(index > 0 ? [{ markup: "\n" }] : []),
    ...parseLine(line),
  ]);
}

const quotePattern = /^(?:&gt;|>)[ \t]?(.*)$/;
const blockQuotePattern = /^(?:&gt;&gt;&gt;|>>>)[ \t]?(.*)$/;
const listPattern = /^([ \t]*)(?:([-•◦▪])|(\d+)\.)[ \t]+(\S.*)$/;

function parseLines(text: string): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  let paragraph: string[] = [];
  let quote: string[] | undefined;
  let quoteToEnd = false;

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ kind: "paragraph", inline: joinLines(paragraph) });
      paragraph = [];
    }
  };
  const flushQuote = () => {
    if (quote) {
      blocks.push({ kind: "quote", inline: joinLines(quote) });
      quote = undefined;
    }
  };

  for (const line of text.split("\n")) {
    if (quoteToEnd) {
      quote!.push(line);
      continue;
    }

    const block = blockQuotePattern.exec(line);
    const single = quotePattern.exec(line);

    if (block || single) {
      flushParagraph();
      quote ??= [];
      quote.push((block ?? single)![1]!);
      quoteToEnd = !!block;
      continue;
    }

    flushQuote();

    const item = listPattern.exec(line);

    if (item) {
      flushParagraph();

      const indent = Math.floor(item[1]!.replaceAll("\t", "  ").length / 2);
      const ordered = item[3] !== undefined;
      const last = blocks.at(-1);

      if (
        last?.kind === "list" &&
        last.ordered === ordered &&
        last.indent === indent
      ) {
        last.items.push(parseLine(item[4]!));
      } else {
        blocks.push({
          kind: "list",
          ordered,
          indent,
          start: ordered ? Number(item[3]) : 1,
          items: [parseLine(item[4]!)],
        });
      }

      continue;
    }

    paragraph.push(line);
  }

  flushParagraph();
  flushQuote();

  return blocks;
}

const trimNewlines = (text: string) => text.replace(/^\n+|\n+$/g, "");

/**
 * Slack message text (mrkdwn) as display blocks: paragraphs with `*bold*`,
 * `_italic_`, `~strike~` and `` `code` ``, `>` quotes, `-`/`•`/`1.` lists and
 * ``` fenced code. Entities in the text are kept for the renderer to resolve.
 * Never throws.
 */
export function parseMrkdwn(text: string): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  let position = 0;

  const addText = (part: string) => {
    const trimmed = trimNewlines(part);

    if (trimmed.trim() !== "") {
      blocks.push(...parseLines(trimmed));
    }
  };

  for (const match of text.matchAll(/```([\s\S]+?)```/g)) {
    addText(text.slice(position, match.index));
    position = match.index + match[0].length;

    const code = trimNewlines(match[1]!);

    if (code === "") {
      addText(match[0]);
    } else {
      blocks.push({ kind: "code", inline: [{ markup: code }] });
    }
  }

  addText(text.slice(position));

  return blocks;
}
