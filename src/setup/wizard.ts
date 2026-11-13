import { slackClient } from "../slack/client";
import { slackErrorCode, slackErrorDetails } from "../slack/errors";
import type { WorkspaceConfig } from "../config/config";
import {
  loadDefaultWorkspaceId,
  loadWorkspace,
  recordWorkspace,
} from "../config/workspace";
import {
  loadSecrets,
  updateSecrets,
  type WorkspaceSecrets,
} from "../config/secrets";
import {
  ConfigTokenInvalidError,
  freshConfigToken,
  rotateConfigToken,
  saveConfigToken,
} from "../slack/configToken";
import { authorizeUser, redirectUri } from "../slack/oauth";
import { appName, buildManifest, manifestHash } from "./manifest";
import { confirm, openBrowser, promptSecret } from "./prompt";

export type Workspace = {
  workspace: WorkspaceConfig;
  secrets: WorkspaceSecrets;
};

/**
 * Runs whichever setup steps are still missing for the default workspace, so an
 * interrupted setup (or a revoked token) resumes where it left off.
 */
export async function ensureWorkspace(): Promise<Workspace> {
  let teamId = await loadDefaultWorkspaceId();

  if (!teamId) {
    console.log("No workspace configured. Let's set one up.\n");

    teamId = await connectConfigToken();
  }

  let workspace = await loadWorkspace(teamId);
  let secrets = await loadSecrets(teamId);

  if (!workspace.appId || !workspace.clientId || !secrets.clientSecret) {
    ({ workspace, secrets } = await withConfigTokenRecovery(teamId, () =>
      createApp(teamId),
    ));
  }

  if (workspace.manifestHash !== manifestHash(buildManifest(redirectUri))) {
    try {
      ({ workspace, secrets } = await withConfigTokenRecovery(
        workspace.teamId,
        () => syncManifest(workspace),
      ));
    } catch (error) {
      console.warn(
        `⚠ Couldn't update your app's manifest, continuing with the current one: ${describeError(error)}\n`,
      );
    }
  }

  if (!secrets.appToken) {
    secrets = await collectAppToken(workspace);
  }

  if (!secrets.userToken) {
    ({ workspace, secrets } = await logIn(workspace, secrets));
  }

  return { workspace, secrets };
}

function describeError(error: unknown): string {
  const code = slackErrorCode(error);

  if (!code) {
    return error instanceof Error ? error.message : String(error);
  }

  const details = slackErrorDetails(error);

  return details ? `${code} ${JSON.stringify(details)}` : code;
}

/**
 * Runs an operation that needs a configuration token. If the stored refresh
 * token is dead, offers to re-run step 1 (which only replaces the token pair)
 * and tries again. Declining rethrows so the caller can skip or fail.
 */
async function withConfigTokenRecovery<T>(
  teamId: string,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!(error instanceof ConfigTokenInvalidError)) {
      throw error;
    }
  }

  console.log(
    "\nYour app configuration token is no longer valid (it was revoked or already used).",
  );
  console.log("Re-running step 1 replaces it; your app and logins are kept.\n");

  if (!confirm("Re-run step 1 now?")) {
    throw new Error("The configuration token is no longer valid.");
  }

  await connectConfigToken(teamId);

  return operation();
}

async function connectConfigToken(expectedTeamId?: string): Promise<string> {
  console.log(
    '1. Opening api.slack.com/apps. Under "Your App Configuration Tokens",',
  );
  console.log(
    '   click "Generate Token", pick your workspace, then copy the Refresh Token.',
  );
  console.log("   https://api.slack.com/apps");

  openBrowser("https://api.slack.com/apps");

  while (true) {
    const refreshToken = await promptSecret("   Paste the refresh token: ");

    if (refreshToken.startsWith("xoxe.xoxp-")) {
      console.log(
        "   That's the access token. Copy the Refresh Token (it starts with xoxe-) instead.",
      );
      continue;
    }

    if (!refreshToken.startsWith("xoxe-")) {
      console.log("   Refresh tokens start with xoxe-. Try again.");
      continue;
    }

    const rotated = await rotateConfigToken(refreshToken);

    if (expectedTeamId && rotated.teamId !== expectedTeamId) {
      console.log(
        `   That token is for a different workspace (${rotated.teamId}). Generate one for ${expectedTeamId}.`,
      );
      continue;
    }

    await saveConfigToken(rotated);
    await recordWorkspace(rotated.teamId, {});

    return rotated.teamId;
  }
}

async function createApp(teamId: string): Promise<Workspace> {
  const token = await freshConfigToken(teamId, await loadSecrets(teamId));

  const manifest = buildManifest(redirectUri);

  const response = await slackClient(token).apps.manifest.create({
    manifest,
  });

  if (
    !response.app_id ||
    !response.credentials?.client_id ||
    !response.credentials.client_secret
  ) {
    throw new Error("apps.manifest.create returned an incomplete response.");
  }

  const workspace = await recordWorkspace(teamId, {
    appId: response.app_id,
    clientId: response.credentials.client_id,
    manifestHash: manifestHash(manifest),
  });

  const updatedSecrets = await updateSecrets(teamId, {
    clientSecret: response.credentials.client_secret,
  });

  console.log(`\n   ✓ Created app "${appName()}" from manifest\n`);

  return { workspace, secrets: updatedSecrets };
}

/**
 * Pushes the current manifest to an existing app (new scopes, events, redirect
 * URL), keeping the name the app already has. If Slack reports changed permissions, the user token is cleared so the
 * login step runs again and the user approves the new scopes.
 */
async function syncManifest(workspace: WorkspaceConfig): Promise<Workspace> {
  const token = await freshConfigToken(
    workspace.teamId,
    await loadSecrets(workspace.teamId),
  );

  const existing = await slackClient(token).apps.manifest.export({
    app_id: workspace.appId ?? "",
  });
  const existingName = existing.manifest?.display_information?.name;

  if (!existingName) {
    throw new Error("apps.manifest.export returned no app name.");
  }

  const manifest = buildManifest(redirectUri, existingName);

  const response = await slackClient(token).apps.manifest.update({
    app_id: workspace.appId ?? "",
    manifest,
  });

  const updatedWorkspace = await recordWorkspace(workspace.teamId, {
    manifestHash: manifestHash(manifest),
  });

  console.log(`✓ Updated app "${existingName}" to the latest manifest\n`);

  if (!response.permissions_updated) {
    return {
      workspace: updatedWorkspace,
      secrets: await loadSecrets(workspace.teamId),
    };
  }

  console.log(
    "The app's permissions changed, so you'll need to sign in again.\n",
  );

  return {
    workspace: updatedWorkspace,
    secrets: await updateSecrets(workspace.teamId, { userToken: undefined }),
  };
}

async function collectAppToken(
  workspace: WorkspaceConfig,
): Promise<WorkspaceSecrets> {
  console.log("2. Opening your new app's settings. Under App-Level Tokens,");
  console.log("   generate one with the connections:write scope.");

  const settingsUrl = `https://api.slack.com/apps/${workspace.appId}/general`;

  console.log(`   ${settingsUrl}`);

  openBrowser(settingsUrl);

  while (true) {
    const appToken = await promptSecret("   Paste the token: ");

    if (!appToken.startsWith("xapp-")) {
      console.log("   App-level tokens start with xapp-. Try again.");
      continue;
    }

    console.log();

    return updateSecrets(workspace.teamId, { appToken });
  }
}

async function logIn(
  workspace: WorkspaceConfig,
  secrets: WorkspaceSecrets,
): Promise<Workspace> {
  console.log("3. Opening browser to authorize...");

  const authorized = await authorizeUser({
    teamId: workspace.teamId,
    clientId: workspace.clientId ?? "",
    clientSecret: secrets.clientSecret ?? "",
  });

  const identity = await slackClient(authorized.userToken).auth.test();

  const updatedWorkspace = await recordWorkspace(workspace.teamId, {
    teamName: identity.team ?? authorized.teamName,
    userId: identity.user_id ?? authorized.userId,
    userName: identity.user,
  });

  const updatedSecrets = await updateSecrets(workspace.teamId, {
    userToken: authorized.userToken,
  });

  console.log(
    `   ✓ Logged in to ${updatedWorkspace.teamName} as ${updatedWorkspace.userName}\n`,
  );

  return { workspace: updatedWorkspace, secrets: updatedSecrets };
}
