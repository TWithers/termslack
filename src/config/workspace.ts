import { loadConfig, type WorkspaceConfig } from "./config";
import {
  applyWorkspaceChanges,
  loadState,
  type WorkspaceState,
  updateState,
} from "./state";

const recordedKeys = [
  "teamName",
  "userId",
  "userName",
  "appId",
  "clientId",
  "manifestHash",
] as const satisfies readonly (keyof WorkspaceState)[];

/** The fields setup records for itself, which live in the state file. */
export type RecordedWorkspace = Pick<
  WorkspaceState,
  (typeof recordedKeys)[number]
>;

/**
 * The workspace as termslack knows it: each setup-recorded field from the state
 * file, else from `config.toml` (written there by an older termslack); `recentDms`
 * and `sections` only from `config.toml`, where the user edits them.
 */
export async function loadWorkspace(teamId: string): Promise<WorkspaceConfig> {
  const [config, state] = await Promise.all([loadConfig(), loadState()]);

  return mergeWorkspace(
    teamId,
    config.workspaces[teamId],
    state.workspaces[teamId],
  );
}

function mergeWorkspace(
  teamId: string,
  configured: WorkspaceConfig | undefined,
  recorded: WorkspaceState | undefined,
): WorkspaceConfig {
  const workspace: WorkspaceConfig = { ...configured, teamId };

  for (const key of recordedKeys) {
    const value = recorded?.[key] ?? configured?.[key];

    if (value === undefined) {
      delete workspace[key];
      continue;
    }

    workspace[key] = value;
  }

  return workspace;
}

/**
 * The workspace termslack starts, if any: a `defaultWorkspace` the user wrote in
 * `config.toml`, else the one setup recorded in the state file.
 */
export async function loadDefaultWorkspaceId(): Promise<string | undefined> {
  const [config, state] = await Promise.all([loadConfig(), loadState()]);

  return config.defaultWorkspace ?? state.defaultWorkspace;
}

/**
 * Records what setup learned about a workspace in the state file, and makes it
 * the default when nothing (neither file) names one yet. Never touches
 * `config.toml`. Returns the workspace as `loadWorkspace` now reads it.
 */
export async function recordWorkspace(
  teamId: string,
  changes: RecordedWorkspace = {},
): Promise<WorkspaceConfig> {
  const configured = (await loadConfig()).defaultWorkspace;

  await updateState((state) => {
    applyWorkspaceChanges(state, teamId, changes);

    if (!configured) {
      state.defaultWorkspace ??= teamId;
    }
  });

  return loadWorkspace(teamId);
}
