import { Box } from "ink";
import { Text } from "../SafeText";
import { ComposerView } from "../input/ComposerView";
import type { Composer } from "../input/useComposer";
import { theme } from "../theme";
import { TitledBox, type TitledLabel } from "../TitledBox";
import { type HoveredButton, withHoveredButton } from "./buttons";
import { MessagePane } from "./MessagePane";
import {
  borderSize,
  insideBorder,
  paneContentWidth,
  panePadding,
} from "./paneLayout";
import { withSelection } from "./selection";
import type { PaneSelection } from "./usePaneSelection";

/**
 * The divider row, `├───┤`, as wide as the box so its ends sit on the left and
 * right border. The joins take the border's colour so they continue the
 * vertical line; the run between them takes the divider's.
 */
function Divider({
  width,
  joinColor,
  runColor,
}: {
  width: number;
  joinColor: string;
  runColor: string;
}) {
  return (
    <Text backgroundColor={theme.paneBackground}>
      <Text color={joinColor}>├</Text>
      <Text color={runColor}>{"─".repeat(Math.max(0, width - 2))}</Text>
      <Text color={joinColor}>┤</Text>
    </Text>
  );
}

/**
 * A titled box holding a list of messages with the input under it: the
 * conversation's, or the thread's. `width` and `height` are the whole box,
 * border included; inside it the content has one column of padding on each
 * side, and the list takes the rows the input leaves.
 */
export function ComposedPane({
  title,
  meta,
  loadingOlder = false,
  statusLine,
  focused,
  selection,
  hoveredButton,
  listFocused,
  composer,
  inputFocused,
  placeholder,
  notice,
  disabledReason,
  width,
  height,
}: {
  /** On the top border, left. */
  title: string;
  /** On the top border, right: the member count, the person's presence, the reply count. */
  meta?: { text: TitledLabel["text"]; color: string };
  /** Fetching older messages: on the top border, right, in place of `meta` while it runs. */
  loadingOlder?: boolean;
  /** What the bottom border says: a question, notices or keys (see `statusLineLabel`). */
  statusLine?: TitledLabel;
  /** Whether the pane or its input has focus: the border and title take the focus colour. */
  focused: boolean;
  selection: PaneSelection;
  /** The interactive element label in the list under the mouse pointer, drawn in the hover background. */
  hoveredButton?: HoveredButton;
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
  const topRight: TitledLabel | undefined = loadingOlder
    ? {
        text: ["Loading older messages…", "Loading older…"],
        color: theme.secondaryText,
      }
    : selection.hasNewBelow
      ? {
          text: ["↓ new messages below", "↓ new"],
          color: theme.newMessages,
        }
      : meta;
  const color = focused ? theme.focus : theme.border;
  const contentWidth = paneContentWidth(width);
  const innerHeight = insideBorder(height);

  return (
    <TitledBox
      width={width}
      height={height}
      borderColor={color}
      background={theme.paneBackground}
      frame={{ flexShrink: 0 }}
      labels={{
        topLeft: { text: title, color, bold: true },
        topRight,
        bottomLeft: statusLine,
      }}
    >
      <Box
        flexDirection="column"
        width={insideBorder(width)}
        height={innerHeight}
        paddingX={panePadding}
        overflow="hidden"
      >
        <MessagePane
          rows={withHoveredButton(
            listFocused
              ? withSelection(selection.visible, selection.selectedTs)
              : selection.visible,
            hoveredButton,
          )}
          width={contentWidth}
          height={Math.max(0, innerHeight - composer.height)}
        />
        <ComposerView
          composer={composer}
          focused={inputFocused}
          placeholder={placeholder}
          disabledReason={disabledReason}
          width={contentWidth}
          notice={notice}
        />
      </Box>
      {composer.dividerRows > 0 ? (
        <Box
          position="absolute"
          top={innerHeight - composer.dividerRows}
          left={-borderSize}
          width={width}
        >
          <Divider
            width={width}
            joinColor={color}
            runColor={inputFocused ? theme.focus : theme.border}
          />
        </Box>
      ) : null}
    </TitledBox>
  );
}
