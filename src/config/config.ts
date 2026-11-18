import { readToml, writeTextAtomic } from "./files";
import { configFile } from "./paths";

/**
 * A workspace's section of `config.toml`. The setup-recorded fields (team and
 * user names and IDs, app ID, client ID, manifest hash) live in the state file
 * now; they appear here only when an older termslack wrote them, and are read as a
 * fallback (see `loadWorkspace`).
 */
export type WorkspaceConfig = {
  teamId: string;
  teamName?: string;
  userId?: string;
  userName?: string;
  appId?: string;
  clientId?: string;
  manifestHash?: string;
  /** How many of the most recent DMs the sidebar lists (the user edits this). */
  recentDms?: number;
  /** Named sidebar sections, in order (the user edits these). Unvalidated: see `parseSections`. */
  sections?: unknown;
};

/** A sidebar section the user defined: a name and the channels in it, by name (with or without `#`) or ID. */
export type SectionConfig = {
  name: string;
  channels: string[];
};

/**
 * The usable sections in a workspace's configured `sections`, in order.
 * Lenient: anything that isn't a list of `{name, channels}` tables is
 * ignored, as are non-string channels and repeats of an earlier section's
 * name.
 */
export function parseSections(configured: unknown): SectionConfig[] {
  if (!Array.isArray(configured)) {
    return [];
  }

  const sections: SectionConfig[] = [];

  for (const item of configured) {
    if (typeof item !== "object" || item === null) {
      continue;
    }

    const { name, channels } = item as Record<string, unknown>;

    if (typeof name !== "string" || !name.trim() || !Array.isArray(channels)) {
      continue;
    }

    if (sections.some((section) => section.name === name.trim())) {
      continue;
    }

    sections.push({
      name: name.trim(),
      channels: channels.flatMap((channel) =>
        typeof channel === "string" && channel.trim() ? [channel.trim()] : [],
      ),
    });
  }

  return sections;
}

export const defaultRecentDms = 10;

/** The configured `recentDms`, or the default unless it is a positive whole number. */
export function recentDmLimit(configured: unknown): number {
  return typeof configured === "number" &&
    Number.isInteger(configured) &&
    configured > 0
    ? configured
    : defaultRecentDms;
}

/**
 * Whether the user turned on the kitty keyboard protocol (the top-level
 * `kittyKeyboard` in `config.toml`). Off unless it is exactly `true`.
 */
export function kittyKeyboardEnabled(configured: unknown): boolean {
  return configured === true;
}

/**
 * Whether the terminal bell rings for mentions and DMs (the top-level `bell`
 * in `config.toml`). On unless it is exactly `false`.
 */
export function bellEnabled(configured: unknown): boolean {
  return configured !== false;
}

/**
 * Whether desktop notifications show for what rings the bell (the top-level
 * `desktopNotifications` in `config.toml`). On unless it is exactly `false`.
 */
export function desktopNotificationsEnabled(configured: unknown): boolean {
  return configured !== false;
}

/**
 * The theme the user chose (the top-level `theme` in `config.toml`), as text
 * to look up: nothing when it is not set, otherwise the configured value, so
 * a value that is no theme's name can be named in the warning.
 */
export function chosenThemeName(configured: unknown): string | undefined {
  if (configured === undefined) {
    return undefined;
  }

  return typeof configured === "string" ? configured : String(configured);
}

const sectionHeader = /^\s*\[\[?\s*[\w"'.\- ]+\]\]?\s*(#.*)?$/;
const keyLine = /^\s*[\w"'.\-]+\s*=/;
const themeLine = /^\s*theme\s*=/;

/**
 * `text`, a config file's TOML, with the top-level `theme` set to `name`,
 * and nothing else changed (comments, order and other keys stay as written):
 * an existing `theme = …` line is replaced, else one is added above the first
 * top-level key or, with none, the first `[section]` (and the comment above it).
 */
export function withThemeLine(text: string, name: string): string {
  const line = `theme = ${JSON.stringify(name)}`;
  const lines = text === "" ? [] : text.replace(/\n$/, "").split("\n");
  const firstSection = lines.findIndex((each) => sectionHeader.test(each));
  const topLevel = lines.slice(
    0,
    firstSection === -1 ? lines.length : firstSection,
  );
  const existing = topLevel.findIndex((each) => themeLine.test(each));

  if (existing !== -1) {
    lines[existing] = line;

    return `${lines.join("\n")}\n`;
  }

  // Before the first top-level key, never after one: a key's value may run
  // over several lines (a multi-line array), and a line after it could land
  // inside the value.
  const firstKey = topLevel.findIndex((each) => keyLine.test(each));
  const before = firstKey === -1 ? firstSection : firstKey;

  if (before === -1) {
    lines.push(line);

    return `${lines.join("\n")}\n`;
  }

  let at = before;

  while (at > 0 && lines[at - 1]!.trimStart().startsWith("#")) {
    at--;
  }

  lines.splice(at, 0, ...(firstKey === -1 ? [line, ""] : [line]));

  return `${lines.join("\n")}\n`;
}

/** Saves `name` as the config's `theme`, editing just that line of the file (see `withThemeLine`). */
export async function saveThemeChoice(name: string): Promise<void> {
  const file = Bun.file(configFile);
  const text = (await file.exists()) ? await file.text() : "";

  await writeTextAtomic(configFile, withThemeLine(text, name), 0o644);
}

export type Config = {
  defaultWorkspace?: string;
  /** Ask the terminal for the kitty keyboard protocol, so Shift+Enter inserts a newline (the user edits this). Unvalidated: see `kittyKeyboardEnabled`. */
  kittyKeyboard?: unknown;
  /** Ring the terminal bell for mentions and DMs, on by default (the user edits this). Unvalidated: see `bellEnabled`. */
  bell?: unknown;
  /** Show a desktop notification for what rings the bell, off by default (the user edits this). Unvalidated: see `desktopNotificationsEnabled`. */
  desktopNotifications?: unknown;
  /** The theme to paint with, by name: `slack-dark` (the default) or one of Omarchy's (the user edits this). Unvalidated: see `chosenThemeName`. */
  theme?: unknown;
  workspaces: Record<string, WorkspaceConfig>;
};

export async function loadConfig(): Promise<Config> {
  const config = await readToml<Partial<Config>>(configFile, {});

  return { ...config, workspaces: config.workspaces ?? {} };
}
