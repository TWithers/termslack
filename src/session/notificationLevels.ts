import type {
  ChannelNotificationLevels,
  NotificationLevelMemory,
} from "../config/state";
import type { Attention } from "./attention";

/**
 * What a channel notifies for: mentions of the user (the default), every new
 * message, or nothing at all.
 */
export type NotificationLevel = "mentions" | "all" | "off";

export type NotificationLevels = {
  /** Loads what an earlier run remembered (keeping anything set since). Never rejects. */
  load(): Promise<void>;
  level(conversationId: string): NotificationLevel;
  /** Sets a channel's level, remembers it and tells views. Does nothing when it already is so. */
  setLevel(conversationId: string, level: NotificationLevel): void;
  /** Whether a message with `attention` in the conversation should notify, by its level alone. */
  notifies(conversationId: string, attention: Attention): boolean;
  /** Writes anything still waiting. */
  flush(): Promise<void>;
};

/**
 * What each channel notifies for, chosen in termslack. Slack's API won't share
 * the user's own per-channel settings, so like muting this is termslack's own,
 * kept by channel ID in the state file. Channels on mentions only aren't kept.
 */
export function createNotificationLevels({
  memory,
  changed,
}: {
  memory?: NotificationLevelMemory;
  changed: () => void;
}): NotificationLevels {
  const levels = new Map<string, "all" | "off">();

  function level(id: string): NotificationLevel {
    return levels.get(id) ?? "mentions";
  }

  function remembered(): ChannelNotificationLevels {
    return Object.fromEntries(levels);
  }

  return {
    async load() {
      const recalled = await memory
        ?.recall()
        .catch((): ChannelNotificationLevels => ({}));
      const entries = Object.entries(recalled ?? {});

      if (entries.length === 0) {
        return;
      }

      for (const [id, stored] of entries) {
        if (!levels.has(id)) {
          levels.set(id, stored);
        }
      }

      changed();
    },
    level,
    setLevel(id, next) {
      if (level(id) === next) {
        return;
      }

      if (next === "mentions") {
        levels.delete(id);
      } else {
        levels.set(id, next);
      }

      memory?.remember(remembered());
      changed();
    },
    notifies(id, attention) {
      switch (level(id)) {
        case "off":
          return false;
        case "all":
          return attention !== "none";
        default:
          return attention === "mention";
      }
    },
    async flush() {
      await memory?.flush();
    },
  };
}
