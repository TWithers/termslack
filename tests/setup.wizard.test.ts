import { afterEach, beforeEach, expect, test } from "bun:test";
import { type FakeSlack, startFakeSlack } from "./support/fakeSlack";
import {
  createSandbox,
  type Sandbox,
  type TermslackRun,
  teamId,
} from "./support/termslack";

let slack: FakeSlack;
let sandbox: Sandbox;

const futureExpiry = () => Math.floor(Date.now() / 1000) + 3600;
const pastExpiry = () => Math.floor(Date.now() / 1000) - 3600;

const callsTo = (method: string) =>
  slack.calls.filter((call) => call.method === method);

function respondLikeSlack(options: { permissionsUpdated?: boolean } = {}) {
  let rotations = 0;

  slack.respond("tooling.tokens.rotate", () => {
    rotations++;

    return {
      ok: true,
      token: `xoxe.xoxp-rotated-${rotations}`,
      refresh_token: `xoxe-rotated-${rotations}`,
      team_id: teamId,
      user_id: "U1",
      exp: futureExpiry(),
    };
  });

  slack.respond("apps.manifest.create", () => ({
    ok: true,
    app_id: "A1",
    credentials: { client_id: "client-1", client_secret: "secret-1" },
  }));

  slack.respond("apps.manifest.export", () => ({
    ok: true,
    manifest: {
      display_information: { name: "slack-tui (tim)" },
    },
  }));

  slack.respond("apps.manifest.update", () => ({
    ok: true,
    permissions_updated: options.permissionsUpdated ?? false,
  }));

  slack.respond("oauth.v2.access", () => ({
    ok: true,
    authed_user: { id: "U1", access_token: "xoxp-new-user" },
    team: { id: teamId, name: "Acme" },
  }));

  slack.respond("auth.test", () => ({
    ok: true,
    team: "Acme",
    user: "tim",
    user_id: "U1",
  }));
}

const appCreated = {
  workspace: {
    appId: "A1",
    clientId: "client-1",
    teamName: "Acme",
    userName: "tim",
  },
};

const validConfigToken = () => ({
  configToken: "xoxe.xoxp-old",
  configRefreshToken: "xoxe-old",
  configTokenExpiresAt: futureExpiry(),
});

beforeEach(() => {
  slack = startFakeSlack();
  sandbox = createSandbox();
});

afterEach(async () => {
  await sandbox.cleanup();
  await slack.stop();
});

async function signInAndConnect(run: TermslackRun) {
  await run.completeSignIn();
  await run.waitForOutput(/Connecting to Acme as tim/);
}

test("with nothing configured, setup walks through all three steps", async () => {
  respondLikeSlack();

  const run = await sandbox.run(slack, ["xoxe-pasted", "xapp-pasted"]);

  await signInAndConnect(run);

  expect(run.output()).toContain("Paste the refresh token");
  expect(run.output()).toContain("Created app");
  expect(run.output()).toContain("Paste the token");
  expect(callsTo("tooling.tokens.rotate")[0]?.params.refresh_token).toBe(
    "xoxe-pasted",
  );

  expect(sandbox.readSecrets()).toMatchObject({
    configRefreshToken: "xoxe-rotated-1",
    clientSecret: "secret-1",
    appToken: "xapp-pasted",
    userToken: "xoxp-new-user",
  });
  expect(sandbox.configText()).toBeUndefined();
  expect(sandbox.readState()).toMatchObject({
    defaultWorkspace: teamId,
    workspaces: {
      [teamId]: {
        teamName: "Acme",
        userId: "U1",
        userName: "tim",
        appId: "A1",
        clientId: "client-1",
      },
    },
  });
  expect(sandbox.readState().workspaces[teamId].manifestHash).toBeString();
});

test("with a configuration token but no app, setup resumes at app creation", async () => {
  respondLikeSlack();

  sandbox.seed({
    workspace: { teamId },
    secrets: validConfigToken(),
  });

  const run = await sandbox.run(slack, ["xapp-pasted"]);

  await signInAndConnect(run);

  expect(run.output()).not.toContain("Paste the refresh token");
  expect(callsTo("apps.manifest.create")).toHaveLength(1);
  expect(callsTo("apps.manifest.create")[0]?.token).toBe("xoxe.xoxp-old");
});

function manifestNameSentTo(method: string) {
  const manifest = callsTo(method)[0]?.params.manifest;

  return JSON.parse(String(manifest)).display_information.name;
}

test("a new app is named termslack after the user", async () => {
  respondLikeSlack();

  const run = await sandbox.run(slack, ["xoxe-pasted", "xapp-pasted"]);

  await signInAndConnect(run);

  expect(manifestNameSentTo("apps.manifest.create")).toMatch(
    /^termslack \(.+\)$/,
  );
});

test("updating an existing app keeps the name the app already has", async () => {
  respondLikeSlack();

  sandbox.seed({
    ...appCreated,
    secrets: {
      ...validConfigToken(),
      clientSecret: "secret-1",
      appToken: "xapp-stored",
      userToken: "xoxp-old-user",
    },
  });

  const run = await sandbox.run(slack);

  await run.waitForOutput(/Updated app "slack-tui \(tim\)"/);

  expect(callsTo("apps.manifest.export")[0]?.params.app_id).toBe("A1");
  expect(manifestNameSentTo("apps.manifest.update")).toBe("slack-tui (tim)");
});

test("with an app but no app-level token, setup resumes at step 2", async () => {
  respondLikeSlack();

  sandbox.seed({
    ...appCreated,
    secrets: { ...validConfigToken(), clientSecret: "secret-1" },
  });

  const run = await sandbox.run(slack, ["xapp-pasted"]);

  await signInAndConnect(run);

  expect(run.output()).not.toContain("Paste the refresh token");
  expect(callsTo("apps.manifest.create")).toHaveLength(0);
  expect(sandbox.readSecrets().appToken).toBe("xapp-pasted");
});

test("with everything but a user token, setup only signs in", async () => {
  respondLikeSlack();

  sandbox.seed({
    ...appCreated,
    secrets: {
      ...validConfigToken(),
      clientSecret: "secret-1",
      appToken: "xapp-stored",
    },
  });

  const run = await sandbox.run(slack);

  await signInAndConnect(run);

  expect(run.output()).not.toContain("Paste the");
  expect(callsTo("apps.manifest.create")).toHaveLength(0);
  expect(callsTo("oauth.v2.access")).toHaveLength(1);
  expect(sandbox.readSecrets()).toMatchObject({
    appToken: "xapp-stored",
    userToken: "xoxp-new-user",
  });
});

test("a renewed configuration token pair is saved before the new token is used", async () => {
  respondLikeSlack();

  sandbox.seed({
    workspace: { teamId },
    secrets: { ...validConfigToken(), configTokenExpiresAt: pastExpiry() },
  });

  let storedWhenNewTokenWasUsed: string | undefined;
  let usedToken: string | undefined;

  slack.respond("apps.manifest.create", (call) => {
    usedToken = call.token;
    storedWhenNewTokenWasUsed = sandbox.readSecrets().configRefreshToken;

    return {
      ok: true,
      app_id: "A1",
      credentials: {
        client_id: "client-1",
        client_secret: `via-${call.token}`,
      },
    };
  });

  const run = await sandbox.run(slack, ["xapp-pasted"]);

  await signInAndConnect(run);

  expect(usedToken).toBe("xoxe.xoxp-rotated-1");
  expect(storedWhenNewTokenWasUsed).toBe("xoxe-rotated-1");
});

test("a revoked user token re-runs only the sign-in step", async () => {
  respondLikeSlack();

  slack.respond("auth.test", (call) =>
    call.token === "xoxp-revoked"
      ? { ok: false, error: "token_revoked" }
      : { ok: true, team: "Acme", user: "tim", user_id: "U1" },
  );

  sandbox.seed({
    ...appCreated,
    secrets: {
      ...validConfigToken(),
      clientSecret: "secret-1",
      appToken: "xapp-stored",
      userToken: "xoxp-revoked",
    },
  });

  const run = await sandbox.run(slack);

  await signInAndConnect(run);

  expect(run.output()).toContain("Your Slack login is no longer valid");
  expect(run.output()).not.toContain("Paste the");
  expect(callsTo("apps.manifest.create")).toHaveLength(0);
  expect(callsTo("tooling.tokens.rotate")).toHaveLength(0);
  expect(sandbox.readSecrets()).toMatchObject({
    appToken: "xapp-stored",
    userToken: "xoxp-new-user",
  });
});

test("a manifest update that changes permissions makes sign-in run again", async () => {
  respondLikeSlack({ permissionsUpdated: true });

  sandbox.seed({
    ...appCreated,
    secrets: {
      ...validConfigToken(),
      clientSecret: "secret-1",
      appToken: "xapp-stored",
      userToken: "xoxp-old-user",
    },
  });

  const run = await sandbox.run(slack);

  await signInAndConnect(run);

  expect(callsTo("apps.manifest.update")).toHaveLength(1);
  expect(run.output()).toContain("permissions changed");
  expect(callsTo("oauth.v2.access")).toHaveLength(1);
  expect(sandbox.readSecrets().userToken).toBe("xoxp-new-user");
});

function rejectOldRefreshToken() {
  slack.respond("tooling.tokens.rotate", (call) => {
    if (call.params.refresh_token === "xoxe-old") {
      return { ok: false, error: "invalid_refresh_token" };
    }

    return {
      ok: true,
      token: "xoxe.xoxp-fresh",
      refresh_token: "xoxe-fresh",
      team_id: teamId,
      user_id: "U1",
      exp: futureExpiry(),
    };
  });
}

const connectedApp = () => ({
  ...appCreated,
  secrets: {
    configToken: "xoxe.xoxp-old",
    configRefreshToken: "xoxe-old",
    configTokenExpiresAt: pastExpiry(),
    clientSecret: "secret-1",
    appToken: "xapp-stored",
    userToken: "xoxp-stored",
  },
});

test("an invalid configuration token offers to re-run step 1 and keeps everything else", async () => {
  respondLikeSlack();
  rejectOldRefreshToken();

  sandbox.seed(connectedApp());

  const run = await sandbox.run(slack, ["y", "xoxe-brand-new"]);

  await run.waitForOutput(/Connecting to Acme as tim/);

  expect(run.output()).toContain("configuration token is no longer valid");
  expect(run.output()).toContain("Paste the refresh token");
  expect(callsTo("tooling.tokens.rotate")[1]?.params.refresh_token).toBe(
    "xoxe-brand-new",
  );
  expect(callsTo("apps.manifest.update")).toHaveLength(1);
  expect(callsTo("apps.manifest.update")[0]?.token).toBe("xoxe.xoxp-fresh");
  expect(callsTo("apps.manifest.create")).toHaveLength(0);

  expect(sandbox.readSecrets()).toMatchObject({
    configToken: "xoxe.xoxp-fresh",
    configRefreshToken: "xoxe-fresh",
    clientSecret: "secret-1",
    appToken: "xapp-stored",
    userToken: "xoxp-stored",
  });
  expect(sandbox.readState().workspaces[teamId].manifestHash).toBeString();
});

test("an invalid configuration token while creating the app also offers step 1", async () => {
  respondLikeSlack();
  rejectOldRefreshToken();

  sandbox.seed({
    workspace: { teamId, teamName: "Acme", userName: "tim" },
    secrets: { ...connectedApp().secrets, clientSecret: undefined },
  });

  const run = await sandbox.run(slack, ["y", "xoxe-brand-new"]);

  await run.waitForOutput(/Connecting to Acme as tim/);

  expect(callsTo("apps.manifest.create")).toHaveLength(1);
  expect(sandbox.readSecrets().clientSecret).toBe("secret-1");
});

test("declining the re-run warns, skips the manifest sync and still connects", async () => {
  respondLikeSlack();
  rejectOldRefreshToken();

  sandbox.seed(connectedApp());

  const run = await sandbox.run(slack, ["n"]);

  await run.waitForOutput(/Connecting to Acme as tim/);

  expect(run.output()).toContain("Couldn't update your app's manifest");
  expect(callsTo("apps.manifest.update")).toHaveLength(0);
  expect(sandbox.readSecrets()).toMatchObject({
    configRefreshToken: "xoxe-old",
    userToken: "xoxp-stored",
  });
});

const commentedConfig = `# my termslack settings
theme = "white"   # light, please

# keep the bell quiet
bell = false

[workspaces.T1]
teamId = "T1"
recentDms = 5  # just a few
`;

const recordedState = {
  defaultWorkspace: teamId,
  workspaces: {
    [teamId]: {
      teamName: "Acme",
      userId: "U1",
      userName: "tim",
      appId: "A1",
      clientId: "client-1",
    },
  },
};

test("rerunning setup (the manifest update included) leaves a commented config.toml byte for byte unchanged", async () => {
  respondLikeSlack();

  sandbox.seed({
    configText: commentedConfig,
    state: recordedState,
    secrets: connectedApp().secrets,
  });

  const run = await sandbox.run(slack);

  await run.waitForOutput(/Connecting to Acme as tim/);

  expect(callsTo("apps.manifest.update")).toHaveLength(1);
  expect(sandbox.configText()).toBe(commentedConfig);
  expect(sandbox.readState().workspaces[teamId].manifestHash).toBeString();
});

test("a config.toml from an older termslack still starts without setup, and its values stay put", async () => {
  respondLikeSlack();

  sandbox.seed({ ...connectedApp() });

  const before = sandbox.configText();
  const run = await sandbox.run(slack);

  await run.waitForOutput(/Connecting to Acme as tim/);

  expect(run.output()).not.toContain("Paste the");
  expect(callsTo("apps.manifest.create")).toHaveLength(0);
  expect(sandbox.configText()).toBe(before);
  expect(sandbox.readState().workspaces[teamId]).toMatchObject({
    manifestHash: expect.any(String),
  });
  expect(sandbox.readState().workspaces[teamId].appId).toBeUndefined();
});

test("state wins over old values in config.toml, and a config.toml defaultWorkspace wins over the recorded one", async () => {
  respondLikeSlack();

  sandbox.seed({
    configText:
      'defaultWorkspace = "T1"\n\n[workspaces.T1]\nteamId = "T1"\nappId = "OLD"\nclientId = "old-client"\n',
    state: {
      defaultWorkspace: "T9",
      workspaces: { [teamId]: recordedState.workspaces[teamId] },
    },
    secrets: connectedApp().secrets,
  });

  const run = await sandbox.run(slack);

  await run.waitForOutput(/Connecting to Acme as tim/);

  expect(callsTo("apps.manifest.update")[0]?.params.app_id).toBe("A1");
});
