import type { WorkspaceSession } from "../../session/workspaceSession";
import { completionListChrome } from "./CompletionList";
import { inputDividerRows } from "./InputBox";
import {
  emptyInput,
  type InputLayout,
  type InputState,
  layoutInput,
} from "./textInput";
import { useCompletion } from "./useCompletion";
import type { useDrafts } from "./useDrafts";

/** The most lines an input box grows to before it scrolls. */
export const maxInputLines = 5;

export type Composer = {
  /** The draft key, or undefined while there is nowhere to write. */
  place?: string;
  draft: InputState;
  layout: InputLayout;
  completion: ReturnType<typeof useCompletion>;
  /** Rows the whole composer takes: the completion list when open, any notice, the divider and the input lines. */
  height: number;
  /** Rows under the divider's top edge: the divider itself and the input lines (the completion list and any notice sit above). */
  dividerRows: number;
};

/**
 * Everything one input box needs to be drawn and laid out: its draft, the
 * wrapped lines, the completion list and the rows they take together. Used for
 * the conversation's input and for the thread's, so both behave alike.
 * `width` is the width of the pane's content (inside its border and padding), `availableHeight` the rows the pane has to
 * share between its messages and this, and `noticeLines` the extra rows the
 * owner draws above the box.
 */
export function useComposer({
  drafts,
  place,
  session,
  width,
  availableHeight,
  focused,
  noticeLines = 0,
}: {
  drafts: ReturnType<typeof useDrafts>;
  place: string | undefined;
  session: WorkspaceSession;
  width: number;
  availableHeight: number;
  focused: boolean;
  noticeLines?: number;
}): Composer {
  const draft = place === undefined ? emptyInput : drafts.get(place);
  const layout = layoutInput(
    draft,
    Math.max(1, width),
    Math.max(
      1,
      Math.min(
        maxInputLines,
        availableHeight - inputDividerRows - 4 - noticeLines,
      ),
    ),
  );
  const completion = useCompletion(place, draft, session.mentionDirectory);
  const completionHeight =
    focused && completion.entries.length > 0
      ? completion.entries.length + completionListChrome
      : 0;

  const dividerRows =
    place === undefined ? 0 : inputDividerRows + layout.lines.length;

  return {
    place,
    draft,
    layout,
    completion,
    height:
      place === undefined ? 0 : completionHeight + noticeLines + dividerRows,
    dividerRows,
  };
}
