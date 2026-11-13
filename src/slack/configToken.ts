import { slackClient } from "./client";
import { slackErrorCode } from "./errors";
import { updateSecrets, type WorkspaceSecrets } from "../config/secrets";

const invalidRefreshTokenErrors = new Set([
  "invalid_refresh_token",
  "invalid_auth",
  "token_revoked",
  "token_expired",
  "not_authed",
]);

/** The stored configuration refresh token was revoked or already used. */
export class ConfigTokenInvalidError extends Error {
  constructor(public readonly teamId: string) {
    super("The stored configuration token is no longer valid.");
  }
}

export type RotatedConfigToken = {
  teamId: string;
  userId: string;
  token: string;
  refreshToken: string;
  expiresAt: number;
};

/**
 * Refresh tokens are single-use, so callers must persist the returned pair
 * before doing anything else with it.
 */
export async function rotateConfigToken(
  refreshToken: string,
): Promise<RotatedConfigToken> {
  const response = await slackClient().tooling.tokens.rotate({
    refresh_token: refreshToken,
  });

  if (
    !response.token ||
    !response.refresh_token ||
    !response.team_id ||
    !response.exp
  ) {
    throw new Error("tooling.tokens.rotate returned an incomplete response.");
  }

  return {
    teamId: response.team_id,
    userId: response.user_id ?? "",
    token: response.token,
    refreshToken: response.refresh_token,
    expiresAt: response.exp,
  };
}

export async function saveConfigToken(
  rotated: RotatedConfigToken,
): Promise<WorkspaceSecrets> {
  return updateSecrets(rotated.teamId, {
    configToken: rotated.token,
    configRefreshToken: rotated.refreshToken,
    configTokenExpiresAt: rotated.expiresAt,
  });
}

export async function freshConfigToken(
  teamId: string,
  secrets: WorkspaceSecrets,
): Promise<string> {
  const nowInSeconds = Math.floor(Date.now() / 1000);

  if (
    secrets.configToken &&
    (secrets.configTokenExpiresAt ?? 0) > nowInSeconds + 60
  ) {
    return secrets.configToken;
  }

  if (!secrets.configRefreshToken) {
    throw new Error(`No configuration refresh token stored for ${teamId}.`);
  }

  let rotated: RotatedConfigToken;

  try {
    rotated = await rotateConfigToken(secrets.configRefreshToken);
  } catch (error) {
    if (invalidRefreshTokenErrors.has(slackErrorCode(error) ?? "")) {
      throw new ConfigTokenInvalidError(teamId);
    }

    throw error;
  }

  await saveConfigToken(rotated);

  return rotated.token;
}
