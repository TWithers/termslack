import { useSyncExternalStore } from "react";
import type { WorkspaceSession } from "../../session/workspaceSession";

/**
 * Re-renders the calling component whenever anything the session holds
 * changes. The returned number carries no meaning: read what the view needs
 * from the session while rendering.
 */
export function useSession(session: WorkspaceSession): number {
  return useSyncExternalStore(session.subscribeToChanges, session.version);
}
