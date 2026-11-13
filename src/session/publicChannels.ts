import type { WebClient } from "@slack/web-api";
import { fetchPublicChannelsPage } from "../slack/conversations";
import type { ChangeTracker } from "./changeTracker";
import type { Conversation } from "./events";

/** `idle` until the listing is first asked for; `failed` ones are tried again when asked for again. */
export type PublicChannelsStatus = "idle" | "loading" | "loaded" | "failed";

export type PublicChannels = {
  status(): PublicChannelsStatus;
  /** Starts the listing unless it is running or done, and settles when it ends. Never rejects. */
  load(): Promise<void>;
};

/** The parts of the workspace store the listing uses. */
export type PublicChannelsStore = {
  conversation(id: string): Conversation | undefined;
  setConversation(conversation: Conversation): void;
};

/**
 * The workspace's public channels, which the user may not be in, listed on
 * demand into the store (as `isMember: false` ones). A channel the store
 * already knows keeps what the store says: its events are newer than the
 * listing, which is only read once per session.
 */
export function createPublicChannels({
  client,
  store,
  changes,
  isStopped,
}: {
  client: () => WebClient;
  store: PublicChannelsStore;
  changes: ChangeTracker;
  isStopped: () => boolean;
}): PublicChannels {
  let status: PublicChannelsStatus = "idle";
  let running: Promise<void> | undefined;

  function setStatus(next: PublicChannelsStatus): void {
    status = next;
    changes.changed();
  }

  async function list(): Promise<void> {
    let cursor: string | undefined;

    do {
      const page = await fetchPublicChannelsPage(client(), cursor);

      for (const conversation of page.conversations) {
        if (!store.conversation(conversation.id)) {
          store.setConversation(conversation);
        }
      }

      cursor = page.nextCursor;
    } while (cursor && !isStopped());
  }

  return {
    status: () => status,

    load() {
      if (status === "loaded" || running) {
        return running ?? Promise.resolve();
      }

      setStatus("loading");

      const pending = list().then(
        () => setStatus("loaded"),
        () => setStatus("failed"),
      );

      running = pending.finally(() => {
        running = undefined;
      });

      return running;
    },
  };
}
