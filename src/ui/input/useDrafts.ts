import { useCallback, useRef, useState } from "react";
import type { Mention } from "../../session/mentions";
import { emptyInput, type InputState } from "./textInput";

/**
 * Where a draft lives: the conversation it is for, and the thread when it is
 * a reply (the thread input keeps its own draft apart from the channel's).
 */
export function draftKey(conversationId: string, threadTs?: string): string {
  return threadTs === undefined
    ? conversationId
    : `${conversationId}:${threadTs}`;
}

/**
 * Unsent text per place you write, kept for as long as the app runs so
 * switching away from a conversation and back finds it as it was left, cursor
 * included. A blank draft is forgotten. The mentions picked from the
 * completion list live beside the text (see `Mention`) and go with it.
 */
export function useDrafts(): {
  get(key: string): InputState;
  set(key: string, state: InputState): void;
  mentions(key: string): Mention[];
  setMentions(key: string, mentions: Mention[]): void;
  /** Drops the drafts (a conversation's own and its threads') of conversations `keep` says no to. Redraws only when it dropped one. */
  prune(keep: (conversationId: string) => boolean): void;
} {
  const drafts = useRef(new Map<string, InputState>());
  const picked = useRef(new Map<string, Mention[]>());
  const [, rerender] = useState(0);

  const set = useCallback((key: string, state: InputState) => {
    if (state.text === "") {
      drafts.current.delete(key);
      picked.current.delete(key);
    } else {
      drafts.current.set(key, state);
    }

    rerender((count) => count + 1);
  }, []);

  return {
    get: (key) => drafts.current.get(key) ?? emptyInput,
    set,
    mentions: (key) => picked.current.get(key) ?? [],
    setMentions(key, mentions) {
      picked.current.set(key, mentions);
      rerender((count) => count + 1);
    },
    prune(keep) {
      const dropped = [...drafts.current.keys()].filter(
        (key) => !keep(key.split(":")[0]!),
      );

      for (const key of dropped) {
        drafts.current.delete(key);
        picked.current.delete(key);
      }

      if (dropped.length > 0) {
        rerender((count) => count + 1);
      }
    },
  };
}
