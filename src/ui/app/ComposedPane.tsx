import { Box } from "ink";
import type { Presence } from "../../session/events";
import { ComposerView } from "../input/ComposerView";
import type { Composer } from "../input/useComposer";
import { theme } from "../theme";
import { MessagePane } from "./MessagePane";
import { withSelection } from "./selection";
import type { PaneSelection } from "./usePaneSelection";

/**
 * A list of messages with the input under it: the conversation's, or the
 * thread's. `height` is the whole column; the list takes what the input
 * leaves.
 */
export function ComposedPane({
  title,
  presence,
  status,
  selection,
  listFocused,
  composer,
  inputFocused,
  placeholder,
  notice,
  disabledReason,
  width,
  height,
}: {
  title: string;
  /** Whether the person of an open DM is active or away, drawn before the title. */
  presence?: Presence;
  /** Shown beside the title, e.g. while older messages load. */
  status?: { text: string; color?: string };
  selection: PaneSelection;
  listFocused: boolean;
  composer: Composer;
  inputFocused: boolean;
  placeholder: string;
  notice?: string;
  /** Why the input takes no text. */
  disabledReason?: string;
  width: number;
  height: number;
}) {
  return (
    <Box
      flexDirection="column"
      width={width}
      flexShrink={0}
      backgroundColor={theme.paneBackground}
    >
      <MessagePane
        title={title}
        presence={presence}
        focused={listFocused}
        hasNewBelow={selection.hasNewBelow}
        status={status}
        rows={
          listFocused
            ? withSelection(selection.visible, selection.selectedTs)
            : selection.visible
        }
        width={width}
        height={Math.max(0, height - composer.height)}
      />
      <ComposerView
        composer={composer}
        focused={inputFocused}
        placeholder={placeholder}
        disabledReason={disabledReason}
        width={width}
        notice={notice}
      />
    </Box>
  );
}
