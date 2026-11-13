import { Text } from "../SafeText";
import { theme } from "../theme";
import type { Run } from "./wrap";

/** One line of styled runs, cut at the edge of its box. A run without a colour is drawn in the theme's text colour. */
export function RunsText({ runs }: { runs: Run[] }) {
  return (
    <Text wrap="truncate">
      {runs.map((run, index) => (
        <Text
          key={index}
          color={run.color ?? theme.text}
          backgroundColor={run.backgroundColor}
          bold={run.bold}
          underline={run.underline}
          italic={run.italic}
          strikethrough={run.strikethrough}
        >
          {run.text}
        </Text>
      ))}
    </Text>
  );
}
