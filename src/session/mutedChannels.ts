import type { MuteMemory } from "../config/state";

export type MutedChannels = {
  /** Loads what an earlier run remembered (keeping anything muted since). Never rejects. */
  load(): Promise<void>;
  isMuted(conversationId: string): boolean;
  /** Mutes or unmutes a channel, remembers it and tells views. Does nothing when it already is so. */
  setMuted(conversationId: string, muted: boolean): void;
  /** Writes anything still waiting. */
  flush(): Promise<void>;
};

/**
 * The channels the user muted in termslack. Slack's API can't mute, so this is
 * termslack's own list, kept by channel ID in the state file. The session owns it so
 * notifications, the startup unread check and every view read one source.
 */
export function createMutedChannels({
  memory,
  changed,
}: {
  memory?: MuteMemory;
  changed: () => void;
}): MutedChannels {
  const muted = new Set<string>();

  return {
    async load() {
      const recalled = await memory?.recall().catch(() => []);

      if (!recalled || recalled.length === 0) {
        return;
      }

      for (const id of recalled) {
        muted.add(id);
      }

      changed();
    },
    isMuted: (id) => muted.has(id),
    setMuted(id, mute) {
      if (muted.has(id) === mute) {
        return;
      }

      if (mute) {
        muted.add(id);
      } else {
        muted.delete(id);
      }

      memory?.remember([...muted]);
      changed();
    },
    async flush() {
      await memory?.flush();
    },
  };
}
