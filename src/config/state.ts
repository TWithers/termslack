import { readToml, writeTomlAtomic } from "./files";
import { parseSections, type SectionConfig } from "./config";
import { stateFile } from "./paths";

/**
 * What termslack remembers about one workspace between runs. Unlike the config, the
 * app writes this file, often, and nobody is expected to edit it.
 */
export type WorkspaceState = {
  /** The workspace's name, as Slack reported it at sign-in (recorded by setup). */
  teamName?: string;
  /** The signed-in user's ID (recorded by setup). */
  userId?: string;
  /** The signed-in user's handle (recorded by setup). */
  userName?: string;
  /** The Slack app setup created for this workspace (recorded by setup). */
  appId?: string;
  /** The app's client ID (recorded by setup). */
  clientId?: string;
  /** The hash of the manifest last pushed to the app (recorded by setup). */
  manifestHash?: string;
  /** The conversation that was open when termslack last changed it. */
  lastConversation?: string;
  /** When each DM last had a message, as far as termslack has seen. */
  dmActivity?: DmActivityState;
  /** The sidebar sections the user collapsed, by section ID (`channels`, `directMessages`, `section:<name>`). */
  collapsedSections?: string[];
  /** The channels the user muted in termslack, by channel ID (Slack doesn't know). */
  mutedChannels?: string[];
  /** Whether the sidebar hides muted channels (`M`); absent means they show. */
  hideMutedChannels?: boolean;
  /** The sidebar sections termslack keeps (channels by ID), in order. Once present, `config.toml`'s `sections` are ignored; an empty list is a kept, empty set. */
  sections?: SectionConfig[];
};

/** What termslack remembers about the recency of a workspace's DMs and group DMs. */
export type DmActivityState = {
  /** Each DM's newest known message `ts`, by conversation ID. */
  latest: Record<string, string>;
  /** DMs Slack won't show history for (deactivated users and the like). */
  hidden: string[];
  /** The local day (`YYYY-MM-DD`) from which activity is known to be current. */
  lastRun?: string;
};

/** Where a session keeps DM activity between runs. */
export type DmActivityCache = {
  /** What an earlier run saved, if anything. Never rejects. */
  load(): Promise<DmActivityState | undefined>;
  /** Records the current state. Writes are debounced; the last state wins. */
  save(state: DmActivityState): void;
  /** Writes anything still waiting; resolves when it's on disk. */
  flush(): Promise<void>;
};

export type State = {
  /** The workspace setup recorded first. A `defaultWorkspace` in `config.toml` wins over it. */
  defaultWorkspace?: string;
  workspaces: Record<string, WorkspaceState>;
};

export async function loadState(): Promise<State> {
  const state = await readToml<Partial<State>>(stateFile, {});

  return {
    ...(state.defaultWorkspace
      ? { defaultWorkspace: state.defaultWorkspace }
      : {}),
    workspaces: state.workspaces ?? {},
  };
}

export async function loadWorkspaceState(
  teamId: string,
): Promise<WorkspaceState> {
  return (await loadState()).workspaces[teamId] ?? {};
}

/** Writes are queued so overlapping updates in this process never lose each other. */
let pendingWrite: Promise<unknown> = Promise.resolve();

/**
 * Reads the state file fresh, lets `change` edit it, and writes it back whole,
 * so other keys (and other workspaces) are kept.
 */
export function updateState(change: (state: State) => void): Promise<void> {
  const write = pendingWrite.then(async () => {
    const state = await loadState();

    change(state);

    await writeTomlAtomic(stateFile, state, 0o600);
  });

  pendingWrite = write.catch(() => undefined);

  return write;
}

/** Changes to a workspace's state; a key set to `undefined` is removed. */
export type WorkspaceChanges = {
  [K in keyof WorkspaceState]: WorkspaceState[K] | undefined;
};

/** Merges `changes` into a workspace's record in `state` (in memory). */
export function applyWorkspaceChanges(
  state: State,
  teamId: string,
  changes: WorkspaceChanges,
): void {
  const merged: Record<string, unknown> = {
    ...state.workspaces[teamId],
    ...changes,
  };

  for (const key of Object.keys(merged)) {
    if (merged[key] === undefined) {
      delete merged[key];
    }
  }

  state.workspaces[teamId] = merged as WorkspaceState;
}

/**
 * Merges `changes` into a workspace's state; a key set to `undefined` is
 * removed.
 */
export function updateWorkspaceState(
  teamId: string,
  changes: WorkspaceChanges,
): Promise<void> {
  return updateState((state) => applyWorkspaceChanges(state, teamId, changes));
}

/** Remembers which conversation is open, so the next start can open it again. */
export type ConversationMemory = {
  /** The remembered conversation's ID, if any. */
  recall(): Promise<string | undefined>;
  /** Records the open conversation (`undefined` to forget). Writes are debounced and skipped when nothing changed. */
  remember(conversationId: string | undefined): void;
  /** Writes anything still waiting; resolves when it's on disk. */
  flush(): Promise<void>;
};

const defaultDebounceMs = 500;

/** A debounced "last value wins" writer into one workspace's state. */
type WorkspaceWriter<T> = {
  /** Queues `value` to be written after the debounce, replacing any earlier one. */
  set(value: T): void;
  /** Writes anything still waiting; resolves when it's on disk. */
  flush(): Promise<void>;
};

/**
 * Debounces writes of one value into a workspace's state. `toPatch` maps the
 * value to the state keys to update, or to `undefined` when there is nothing
 * to write. Failing to write is swallowed: not being able to remember is no
 * reason to disturb the user.
 */
function debouncedWorkspaceWriter<T>(
  teamId: string,
  { debounceMs = defaultDebounceMs }: { debounceMs?: number },
  toPatch: (
    value: T,
  ) =>
    | Parameters<typeof updateWorkspaceState>[1]
    | undefined
    | Promise<Parameters<typeof updateWorkspaceState>[1] | undefined>,
): WorkspaceWriter<T> {
  let wanted: { value: T } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let writing: Promise<void> = Promise.resolve();

  async function write(): Promise<void> {
    clearTimeout(timer);
    timer = undefined;

    const target = wanted;

    wanted = undefined;

    if (!target) {
      return;
    }

    const patch = await toPatch(target.value);

    if (!patch) {
      return;
    }

    await updateWorkspaceState(teamId, patch).catch(() => undefined);
  }

  return {
    set(value) {
      wanted = { value };
      clearTimeout(timer);
      timer = setTimeout(() => {
        writing = writing.then(write);
      }, debounceMs);
    },
    flush() {
      writing = writing.then(write);

      return writing;
    },
  };
}

/** A workspace's `ConversationMemory`, kept in the state file. */
export function workspaceConversationMemory(
  teamId: string,
  options: { debounceMs?: number } = {},
): ConversationMemory {
  let known: Promise<string | undefined> | undefined;

  const recall = () =>
    (known ??= loadWorkspaceState(teamId).then(
      (state) => state.lastConversation,
      () => undefined,
    ));

  const writer = debouncedWorkspaceWriter<string | undefined>(
    teamId,
    options,
    async (id) => {
      if (id === (await recall())) {
        return undefined;
      }

      known = Promise.resolve(id);

      return { lastConversation: id };
    },
  );

  return {
    recall,
    remember: writer.set,
    flush: writer.flush,
  };
}

/** A workspace's `DmActivityCache`, kept in the state file. */
export function workspaceDmActivityCache(
  teamId: string,
  options: { debounceMs?: number } = {},
): DmActivityCache {
  const writer = debouncedWorkspaceWriter<DmActivityState>(
    teamId,
    options,
    (state) => ({ dmActivity: state }),
  );

  return {
    async load() {
      const state = await loadWorkspaceState(teamId).catch(() => undefined);
      const stored = state?.dmActivity;

      return stored
        ? {
            latest: stored.latest ?? {},
            hidden: stored.hidden ?? [],
            lastRun: stored.lastRun,
          }
        : undefined;
    },
    save: writer.set,
    flush: writer.flush,
  };
}

/** Remembers which sidebar sections are collapsed. */
export type CollapseMemory = {
  /** The collapsed section IDs an earlier run saved. Never rejects. */
  recall(): Promise<string[]>;
  /** Records the collapsed section IDs. Writes are debounced; the last state wins. */
  remember(collapsedIds: string[]): void;
  /** Writes anything still waiting; resolves when it's on disk. */
  flush(): Promise<void>;
};

/** A workspace's `CollapseMemory`, kept in the state file. */
export function workspaceCollapseMemory(
  teamId: string,
  options: { debounceMs?: number } = {},
): CollapseMemory {
  const writer = debouncedWorkspaceWriter<string[]>(
    teamId,
    options,
    (collapsedIds) => ({
      collapsedSections: collapsedIds.length > 0 ? collapsedIds : undefined,
    }),
  );

  return {
    async recall() {
      const state = await loadWorkspaceState(teamId).catch(() => undefined);
      const stored: unknown = state?.collapsedSections;

      return Array.isArray(stored)
        ? stored.filter((id): id is string => typeof id === "string")
        : [];
    },
    remember: writer.set,
    flush: writer.flush,
  };
}

/** Remembers which channels the user muted. */
export type MuteMemory = {
  /** The muted channel IDs an earlier run saved. Never rejects. */
  recall(): Promise<string[]>;
  /** Records the muted channel IDs. Writes are debounced; the last state wins. */
  remember(mutedIds: string[]): void;
  /** Writes anything still waiting; resolves when it's on disk. */
  flush(): Promise<void>;
};

/** A workspace's `MuteMemory`, kept in the state file. */
export function workspaceMuteMemory(
  teamId: string,
  options: { debounceMs?: number } = {},
): MuteMemory {
  const writer = debouncedWorkspaceWriter<string[]>(
    teamId,
    options,
    (mutedIds) => ({
      mutedChannels: mutedIds.length > 0 ? mutedIds : undefined,
    }),
  );

  return {
    async recall() {
      const state = await loadWorkspaceState(teamId).catch(() => undefined);
      const stored: unknown = state?.mutedChannels;

      return Array.isArray(stored)
        ? stored.filter((id): id is string => typeof id === "string")
        : [];
    },
    remember: writer.set,
    flush: writer.flush,
  };
}

/** Remembers whether the sidebar hides muted channels. */
export type HideMutedMemory = {
  /** Whether an earlier run left muted channels hidden. Never rejects. */
  recall(): Promise<boolean>;
  /** Records the choice. Writes are debounced; the last state wins. */
  remember(hidden: boolean): void;
  /** Writes anything still waiting; resolves when it's on disk. */
  flush(): Promise<void>;
};

/** A workspace's `HideMutedMemory`, kept in the state file. */
export function workspaceHideMutedMemory(
  teamId: string,
  options: { debounceMs?: number } = {},
): HideMutedMemory {
  const writer = debouncedWorkspaceWriter<boolean>(
    teamId,
    options,
    (hidden) => ({ hideMutedChannels: hidden ? true : undefined }),
  );

  return {
    async recall() {
      const state = await loadWorkspaceState(teamId).catch(() => undefined);

      return state?.hideMutedChannels === true;
    },
    remember: writer.set,
    flush: writer.flush,
  };
}

/** Remembers the sidebar sections termslack keeps. */
export type SectionsMemory = {
  /** The sections an earlier run kept, or nothing when termslack doesn't keep any yet. Never rejects. */
  recall(): Promise<SectionConfig[] | undefined>;
  /** Records the sections. Writes are debounced; the last state wins. */
  remember(sections: SectionConfig[]): void;
  /** Writes anything still waiting; resolves when it's on disk. */
  flush(): Promise<void>;
};

/** A workspace's `SectionsMemory`, kept in the state file. */
export function workspaceSectionsMemory(
  teamId: string,
  options: { debounceMs?: number } = {},
): SectionsMemory {
  const writer = debouncedWorkspaceWriter<SectionConfig[]>(
    teamId,
    options,
    (sections) => ({ sections }),
  );

  return {
    async recall() {
      const state = await loadWorkspaceState(teamId).catch(() => undefined);

      return Array.isArray(state?.sections)
        ? parseSections(state.sections)
        : undefined;
    },
    remember: writer.set,
    flush: writer.flush,
  };
}
