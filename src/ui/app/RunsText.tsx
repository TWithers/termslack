import { Text as InkText } from "ink";
import { hyperlink } from "../hyperlink";
import { Text } from "../SafeText";
import { terminalSafeText } from "../terminalSafeText";
import { theme } from "../theme";
import type { Run } from "./wrap";

/**
 * A run's text as a terminal hyperlink. Ink's own `Text` draws it so only the
 * text is made terminal safe, never the address.
 */
function Hyperlink({ text, url }: { text: string; url: string }) {
  return <InkText>{hyperlink(terminalSafeText(text), url)}</InkText>;
}

/** One run in its style; without a colour it is drawn in the theme's text colour. */
export function RunText({ run }: { run: Run }) {
  return (
    <Text
      color={run.color ?? theme.text}
      backgroundColor={run.backgroundColor}
      bold={run.bold}
      underline={run.underline}
      italic={run.italic}
      strikethrough={run.strikethrough}
    >
      {run.url ? <Hyperlink text={run.text} url={run.url} /> : run.text}
    </Text>
  );
}

/** One line of styled runs, cut at the edge of its box. */
export function RunsText({ runs }: { runs: Run[] }) {
  return (
    <Text wrap="truncate">
      {runs.map((run, index) => (
        <RunText key={index} run={run} />
      ))}
    </Text>
  );
}
