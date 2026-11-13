import { useRef, useState } from "react";
import type { WorkspaceSession } from "../../session/workspaceSession";
import {
  channelDetailsItems,
  type ChannelDetailsContent,
} from "./ChannelDetails";
import { overlayChrome, overlayPadding } from "./Overlay";
import { pressed, type KeyPress } from "./shortcuts";
import type { ChannelRef } from "./useConfirmPrompt";
import { handleListKey, useListView } from "./useListView";

/**
 * The channel details popup the channel menu opens: what Slack says about
 * one channel, asked fresh each time it opens (it says "Loading…" until
 * Slack answers, or why it refused). It is read-only and scrolls like the
 * help; Esc closes it. `height` and `width` are the rows and columns the
 * popup may take; the text wraps to the width, one item per line.
 */
export function useChannelDetails({
  session,
  height,
  width,
}: {
  session: WorkspaceSession;
  height: number;
  width: number;
}) {
  const [shown, setShown] = useState<{
    channel: ChannelRef;
    section?: string;
    content: ChannelDetailsContent;
  }>();
  /** Counts opens, so a slow answer for a popup that was closed or reopened changes nothing. */
  const opens = useRef(0);
  const items = shown
    ? channelDetailsItems(
        shown.content,
        width - overlayPadding,
        session,
        shown.section,
        session.isMuted(shown.channel.id),
      )
    : [];
  const view = useListView({
    count: items.length,
    height: height - overlayChrome(false),
    selectable: false,
  });

  function close() {
    opens.current += 1;
    setShown(undefined);
  }

  return {
    isOpen: shown !== undefined,
    title: shown ? `${shown.channel.label} details` : "",
    items,
    start: view.start,
    /** Asks Slack about `channel` and shows the popup; `section` is the name of the sidebar section it is in. */
    open(channel: ChannelRef, section: string | undefined) {
      const mine = ++opens.current;

      view.reset();
      setShown({ channel, section, content: { status: "loading" } });

      void session.channelDetails(channel.id).then((result) => {
        if (opens.current !== mine) {
          return;
        }

        setShown({
          channel,
          section,
          content: result.ok
            ? { status: "loaded", details: result.details }
            : { status: "failed", message: result.message },
        });
      });
    },
    close,
    /** Scrolls the popup `delta` lines, as the arrows do. */
    scroll: view.move,
    /** Handles a key while the popup is open. */
    onKey(input: string, key: KeyPress) {
      if (pressed("overlay.close", input, key)) {
        close();
        return;
      }

      handleListKey(view, input, key);
    },
  };
}

export type ChannelDetailsPopup = ReturnType<typeof useChannelDetails>;
