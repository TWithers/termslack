import { useEffect, useRef } from "react";
import type { ConversationMemory } from "../../config/state";
import type { WorkspaceSession } from "../../session/workspaceSession";

/**
 * Once, at startup: recalls the remembered conversation and, when the
 * session's listing confirms the user is still in it and it isn't archived,
 * calls `reopen`. A conversation the loaded listing doesn't confirm is
 * forgotten. If the listing never loads, the memory is left alone for next
 * time. Nothing is reopened if the user has opened something in the meantime.
 * Never blocks: it all happens in the background.
 */
export function useReopenLast({
  session,
  memory,
  openId,
  reopen,
}: {
  session: WorkspaceSession;
  memory?: ConversationMemory;
  openId?: string;
  reopen(conversationId: string): void;
}): void {
  const latest = useRef({ openId, reopen });

  useEffect(() => {
    latest.current = { openId, reopen };
  });

  useEffect(() => {
    if (!memory) {
      return;
    }

    let cancelled = false;

    void (async () => {
      const id = await memory.recall();

      if (!id || cancelled) {
        return;
      }

      const found = await session.findConversation(id);

      if (cancelled || latest.current.openId !== undefined) {
        return;
      }

      const conversation =
        found.status === "found" ? found.conversation : undefined;

      if (conversation?.isMember && !conversation.isArchived) {
        latest.current.reopen(id);

        return;
      }

      if (session.listingHealth().conversations === "loaded") {
        memory.remember(undefined);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [session, memory]);
}
