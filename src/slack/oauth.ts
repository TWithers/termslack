import { slackClient } from "./client";
import { userScopes } from "../setup/manifest";
import { openBrowser } from "../setup/prompt";

const host = "127.0.0.1";

/** TERMSLACK_OAUTH_PORT moves the callback listener and redirect URL, e.g. so tests don't collide. */
const port = Number(process.env.TERMSLACK_OAUTH_PORT) || 53682;

const timeoutMs = 5 * 60 * 1000;

/**
 * Plain-HTTP loopback redirect, per RFC 8252 for native apps. Slack's docs say
 * redirect URLs need HTTPS, but its manifest validator accepts loopback HTTP.
 * The IP literal (not "localhost") avoids IPv4/IPv6 resolution mismatches.
 */
export const redirectUri = `http://${host}:${port}/callback`;

export type AuthorizedUser = {
  userToken: string;
  userId: string;
  teamId: string;
  teamName: string;
};

function page(message: string): Response {
  return new Response(
    `<!doctype html><title>termslack</title><body style="font-family:system-ui;padding:3rem"><h2>${message}</h2></body>`,
    {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    },
  );
}

async function waitForAuthorizationCode(
  authorizeUrl: URL,
  state: string,
): Promise<string> {
  const { promise, resolve, reject } = Promise.withResolvers<string>();

  const server = Bun.serve({
    port,
    hostname: host,
    fetch(request) {
      const url = new URL(request.url);

      if (
        url.pathname !== "/callback" ||
        url.searchParams.get("state") !== state
      ) {
        return new Response("Not found", { status: 404 });
      }

      const error = url.searchParams.get("error");

      if (error) {
        reject(new Error(`Authorization was not granted: ${error}`));

        return page("Authorization cancelled. You can close this tab.");
      }

      resolve(url.searchParams.get("code") ?? "");

      return page(
        "Authorization received. You can close this tab and return to your terminal.",
      );
    },
  });

  const timeout = setTimeout(
    () => reject(new Error("Timed out waiting for authorization.")),
    timeoutMs,
  );

  openBrowser(authorizeUrl.toString());
  console.log(`   If the browser didn't open, visit:\n   ${authorizeUrl}\n`);

  try {
    return await promise;
  } finally {
    clearTimeout(timeout);
    server.stop();
  }
}

export async function authorizeUser(options: {
  teamId: string;
  clientId: string;
  clientSecret: string;
}): Promise<AuthorizedUser> {
  const state = crypto.randomUUID();

  const authorizeUrl = new URL("https://slack.com/oauth/v2/authorize");

  authorizeUrl.search = new URLSearchParams({
    client_id: options.clientId,
    user_scope: userScopes.join(","),
    redirect_uri: redirectUri,
    state,
    team: options.teamId,
  }).toString();

  const code = await waitForAuthorizationCode(authorizeUrl, state);

  const response = await slackClient().oauth.v2.access({
    client_id: options.clientId,
    client_secret: options.clientSecret,
    code,
    redirect_uri: redirectUri,
  });

  const userToken = response.authed_user?.access_token;

  if (!userToken) {
    throw new Error("Slack did not return a user token.");
  }

  return {
    userToken,
    userId: response.authed_user?.id ?? "",
    teamId: response.team?.id ?? options.teamId,
    teamName: response.team?.name ?? "",
  };
}
