#!/usr/bin/env bun
import {
  bellEnabled,
  chosenThemeName,
  desktopNotificationsEnabled,
  kittyKeyboardEnabled,
  loadConfig,
  parseSections,
  recentDmLimit,
  saveThemeChoice,
} from "./config/config";
import { helpText, type Options, parseArgs, versionText } from "./cli";
import { slackClient } from "./slack/client";
import { slackErrorCode, slackErrorDetails } from "./slack/errors";
import {
  workspaceCollapseMemory,
  workspaceHideMutedMemory,
  workspaceConversationMemory,
  workspaceDmActivityCache,
  workspaceMuteMemory,
  workspaceSectionsMemory,
} from "./config/state";
import { updateSecrets } from "./config/secrets";
import { ensureWorkspace } from "./setup/wizard";
import {
  createWorkspaceSession,
  type WorkspaceSession,
} from "./session/workspaceSession";
import { runApp } from "./ui/app/run";
import { logInfo, logMessage, logSessionHeld } from "./ui/eventLog";

const revokedTokenErrors = new Set([
  "invalid_auth",
  "token_revoked",
  "token_expired",
  "account_inactive",
  "not_authed",
]);

/**
 * Acts on the command line: prints the version or help, rejects an unknown
 * option, or returns the options for a normal run.
 */
function resolveOptions(): Options {
  const parsed = parseArgs(process.argv.slice(2));

  if (parsed.action === "version") {
    console.log(versionText);
    process.exit(0);
  }

  if (parsed.action === "help") {
    console.log(helpText);
    process.exit(0);
  }

  if (parsed.action === "error") {
    console.error(
      `\n✗ ${parsed.message}\n  Run \`termslack --help\` to see the options.`,
    );
    process.exit(1);
  }

  return parsed.options;
}

const options = resolveOptions();

/** The workspace and user a token belongs to, for the sidebar and status line. */
async function describeToken(
  userToken: string,
): Promise<{ workspaceName: string; userName?: string }> {
  try {
    const identity = await slackClient(userToken).auth.test();

    return { workspaceName: identity.team ?? "Slack", userName: identity.user };
  } catch {
    return { workspaceName: "Slack" };
  }
}

/**
 * TERMSLACK_APP_TOKEN + TERMSLACK_USER_TOKEN skip setup and the credential store entirely,
 * which is handy for scripting and testing.
 */
async function resolveTokens(): Promise<{
  appToken: string;
  userToken: string;
  label: string;
  workspaceName: string;
  userName?: string;
  teamId?: string;
  recentDms?: number;
  sections?: unknown;
}> {
  const { TERMSLACK_APP_TOKEN, TERMSLACK_USER_TOKEN } = process.env;

  if (TERMSLACK_APP_TOKEN && TERMSLACK_USER_TOKEN) {
    return {
      appToken: TERMSLACK_APP_TOKEN,
      userToken: TERMSLACK_USER_TOKEN,
      label: "tokens from environment",
      ...(await describeToken(TERMSLACK_USER_TOKEN)),
    };
  }

  while (true) {
    const { workspace, secrets } = await ensureWorkspace();

    try {
      await slackClient(secrets.userToken).auth.test();
    } catch (error) {
      if (!revokedTokenErrors.has(slackErrorCode(error) ?? "")) {
        throw error;
      }

      console.log(
        "Your Slack login is no longer valid. Let's sign in again.\n",
      );

      await updateSecrets(workspace.teamId, { userToken: undefined });
      continue;
    }

    return {
      appToken: secrets.appToken ?? "",
      userToken: secrets.userToken ?? "",
      label: `${workspace.teamName} as ${workspace.userName}`,
      workspaceName: workspace.teamName ?? "Slack",
      userName: workspace.userName,
      teamId: workspace.teamId,
      recentDms: workspace.recentDms,
      sections: workspace.sections,
    };
  }
}

type Connected = {
  session: WorkspaceSession;
  workspaceName: string;
  userName?: string;
  /** Undefined when tokens come from the environment: there's no workspace to remember things for. */
  teamId?: string;
  /** The workspace's configured `recentDms`, unvalidated. */
  recentDms?: unknown;
  /** The workspace's configured `sections`, unvalidated. */
  sections?: unknown;
  /** The event log's hold on events, when running in log mode. */
  log?: ReturnType<typeof logSessionHeld>;
};

async function connect(): Promise<Connected> {
  const {
    appToken,
    userToken,
    label,
    teamId,
    workspaceName,
    userName,
    recentDms,
    sections,
  } = await resolveTokens();

  if (options.log) {
    logInfo(`Connecting to ${label}... (Ctrl+C to quit)`);
  }

  const session = createWorkspaceSession(
    appToken,
    userToken,
    {},
    {
      // The event log has no sidebar to order, so it skips the background pass.
      dmActivity: options.log
        ? undefined
        : { cache: teamId ? workspaceDmActivityCache(teamId) : undefined },
      unreadCheck: options.log ? undefined : {},
      muteMemory: teamId ? workspaceMuteMemory(teamId) : undefined,
      configuredSections: parseSections(sections),
      sectionsMemory: teamId ? workspaceSectionsMemory(teamId) : undefined,
    },
  );

  const log = options.log ? logSessionHeld(session, options.raw) : undefined;

  try {
    await session.start();

    return {
      session,
      workspaceName,
      userName,
      teamId,
      recentDms,
      sections,
      log,
    };
  } catch (error) {
    if (!teamId || !revokedTokenErrors.has(slackErrorCode(error) ?? "")) {
      throw error;
    }

    console.log(
      "\nYour app-level token is no longer valid. Let's replace it.\n",
    );

    await updateSecrets(teamId, { appToken: undefined });

    return connect();
  }
}

/** Prints the recent history of a conversation, and returns the ts of what it printed. */
async function printHistory(
  session: WorkspaceSession,
  reference: string,
): Promise<{ channelId: string; printed: Set<string> }> {
  const found = await session.findConversation(reference);

  if (found.status === "notFound") {
    const close =
      found.suggestions.length > 0
        ? `\n  Did you mean: ${found.suggestions.join(", ")}?`
        : "";

    throw new Error(`${found.message}${close}`);
  }

  const channelId = found.status === "found" ? found.conversation.id : found.id;

  try {
    const page = await session.loadHistory(channelId);
    const shown = page.messages.filter((message) => !message.isDeleted);

    logInfo(`Recent history in ${reference}:`);

    for (const message of shown) {
      logMessage(message, session);
    }

    if (shown.length === 0) {
      logInfo("(no messages)");
    }

    logInfo("Live events:");

    return { channelId, printed: new Set(shown.map((message) => message.ts)) };
  } catch (error) {
    const code = slackErrorCode(error);

    if (!code) {
      throw error;
    }

    throw new Error(
      `Couldn't load history for ${reference}: Slack says ${code}.`,
    );
  }
}

async function main(): Promise<void> {
  const { session, workspaceName, teamId, recentDms, sections, log } =
    await connect();

  if (!log) {
    const { kittyKeyboard, bell, desktopNotifications, theme } =
      await loadConfig();

    await runApp(
      {
        session,
        workspaceName,
        recentDms: recentDmLimit(recentDms),
        conversationMemory: teamId
          ? workspaceConversationMemory(teamId)
          : undefined,
        collapseMemory: teamId ? workspaceCollapseMemory(teamId) : undefined,
        hideMutedMemory: teamId ? workspaceHideMutedMemory(teamId) : undefined,
        saveTheme: saveThemeChoice,
      },
      {
        kittyKeyboard: kittyKeyboardEnabled(kittyKeyboard),
        themeName: chosenThemeName(theme),
        bell: bellEnabled(bell),
        desktopNotifications: desktopNotificationsEnabled(desktopNotifications),
      },
    );
    process.exit(0);
  }

  process.on("SIGINT", async () => {
    await session.stop();
    process.exit(0);
  });

  if (options.history === undefined) {
    log.release();
    return;
  }

  const { channelId, printed } = await printHistory(session, options.history);

  log.release(
    (event) =>
      event.kind === "message" &&
      event.channelId === channelId &&
      printed.has(event.ts),
  );
}

main().catch((error) => {
  const code = slackErrorCode(error);
  const details = slackErrorDetails(error);

  console.error(
    `\n✗ ${code ? `Slack API error: ${code}` : error instanceof Error ? error.message : String(error)}`,
  );

  if (details) {
    console.error(JSON.stringify(details, null, 2));
  }

  process.exit(1);
});
