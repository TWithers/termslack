import type { SectionConfig } from "../config/config";
import type { SectionsMemory } from "../config/state";
import { type Conversation, isChannel } from "./events";

export const sectionsNote =
  "Sections are now kept by termslack; the ones in config.toml are ignored";

export type SectionChange = { ok: true } | { ok: false; reason: string };

export type Sections = {
  /** Loads the sections termslack keeps from an earlier run, if it has any. Never rejects. */
  load(): Promise<void>;
  /** The sections to show, in order: termslack's own once it keeps them, else the config's. */
  shown(): SectionConfig[];
  /** Whether termslack keeps the sections (in the state file) and `config.toml`'s are ignored. */
  keptByTermslack(): boolean;
  /** The one-time note for the status bar, set when termslack takes the sections over. */
  note(): string | undefined;
  /** Puts a channel in a section (taking it out of any other). Fails when no section has that name. */
  moveToSection(channelId: string, sectionName: string): SectionChange;
  /** Takes a channel out of every section, back to Channels. */
  removeFromSections(channelId: string): void;
  /** Creates an empty section after the last one. Fails on an empty name or one a section already has. */
  addSection(name: string): SectionChange;
  /** Writes anything still waiting. */
  flush(): Promise<void>;
};

/**
 * The sidebar's sections. They come from `config.toml` until the first
 * change; that change copies what is shown into the state file (channels by
 * ID), and from then on the state file alone is read. The session owns them
 * so every view redraws at once after a change, as it does for muting.
 */
export function createSections({
  configured,
  memory,
  conversations,
  changed,
}: {
  configured: SectionConfig[];
  memory?: SectionsMemory;
  conversations: () => Conversation[];
  changed: () => void;
}): Sections {
  let kept: SectionConfig[] | undefined;
  let note: string | undefined;

  const shown = () => kept ?? configured;

  /** The sections as they'd be kept: every reference made an ID (first section wins), unknown ones dropped. */
  function copyOfConfigured(): SectionConfig[] {
    const known = conversations().filter(({ kind }) => isChannel(kind));
    const placed = new Set<string>();

    return configured.map(({ name, channels }) => ({
      name,
      channels: channels.flatMap((reference) => {
        const wanted = reference.replace(/^#/, "").toLowerCase();
        const match = known.find(
          ({ id, name }) =>
            id.toLowerCase() === wanted || name?.toLowerCase() === wanted,
        );

        if (!match || placed.has(match.id)) {
          return [];
        }

        placed.add(match.id);

        return [match.id];
      }),
    }));
  }

  /** Applies a change to the sections, keeps the result (first copying the config's), and tells the views. */
  function commit(
    change: (sections: SectionConfig[]) => SectionConfig[],
  ): void {
    const base = kept ?? copyOfConfigured();
    const next = change(base);

    if (!kept && JSON.stringify(next) === JSON.stringify(copyOfConfigured())) {
      return;
    }

    if (!kept && configured.length > 0) {
      note = sectionsNote;
    }

    kept = next;
    memory?.remember(next);
    changed();
  }

  return {
    async load() {
      const recalled = await memory?.recall().catch(() => undefined);

      if (recalled) {
        kept = recalled;
        changed();
      }
    },
    shown,
    keptByTermslack: () => kept !== undefined,
    note: () => note,
    moveToSection(channelId, sectionName) {
      if (!shown().some(({ name }) => name === sectionName)) {
        return {
          ok: false,
          reason: `There is no section named ${sectionName}`,
        };
      }

      commit((sections) =>
        sections.map((section) => {
          const others = section.channels.filter((id) => id !== channelId);

          return section.name === sectionName
            ? { ...section, channels: [...others, channelId] }
            : { ...section, channels: others };
        }),
      );

      return { ok: true };
    },
    removeFromSections(channelId) {
      commit((sections) =>
        sections.map((section) => ({
          ...section,
          channels: section.channels.filter((id) => id !== channelId),
        })),
      );
    },
    addSection(requested) {
      const name = requested.trim();

      if (name === "") {
        return { ok: false, reason: "A section needs a name" };
      }

      const wanted = name.toLowerCase();

      if (
        shown().some((section) => section.name.trim().toLowerCase() === wanted)
      ) {
        return {
          ok: false,
          reason: `There is already a section named ${name}`,
        };
      }

      commit((sections) => [...sections, { name, channels: [] }]);

      return { ok: true };
    },
    async flush() {
      await memory?.flush();
    },
  };
}
