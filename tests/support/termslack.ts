import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorkspaceSecrets } from "../../src/config/secrets";
import { type FakeSlack, waitFor } from "./fakeSlack";

export const teamId = "T1";

const authorizeUrlPattern = /https:\/\/slack\.com\/oauth\/v2\/authorize\?\S+/;

export type TermslackRun = {
  /** Everything termslack has printed so far. */
  output(): string;
  /** Resolves with the output once it matches, or fails after the timeout. */
  waitForOutput(pattern: RegExp, timeoutMs?: number): Promise<string>;
  /** Plays the browser: hits the callback of the printed authorize URL. */
  completeSignIn(code?: string): Promise<void>;
  /** Resolves with the exit code once the process ends. */
  exited: Promise<number>;
  stop(): Promise<void>;
};

export type RunOptions = {
  /** Command-line arguments, e.g. `["--history", "general"]`. */
  args?: string[];
  /** Opens the UI instead of the event log, which is what runs by default in tests. */
  ui?: boolean;
  /** Extra environment variables, e.g. tokens to skip setup. */
  env?: Record<string, string>;
};

export type Sandbox = {
  readSecrets(): WorkspaceSecrets;
  /** The parsed `config.toml` (empty when there is none). */
  readConfig(): Record<string, any>;
  /** `config.toml` as written, or undefined when there is none. */
  configText(): string | undefined;
  /** The parsed state file (empty when there is none). */
  readState(): Record<string, any>;
  seed(options: {
    /** An old-style workspace: written into `config.toml`, as an older termslack did. */
    workspace?: Record<string, unknown>;
    /** The text of a hand-written `config.toml`, instead of `workspace`. */
    configText?: string;
    /** The state file's contents. */
    state?: Record<string, unknown>;
    secrets?: WorkspaceSecrets;
  }): void;
  /** Starts the real entry point against fake Slack, answering prompts from `answers`. */
  run(
    slack: FakeSlack,
    answers?: string[],
    options?: RunOptions,
  ): Promise<TermslackRun>;
  cleanup(): Promise<void>;
};

async function freePort(): Promise<number> {
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: () => new Response(),
  });

  const port = server.port as number;

  await server.stop(true);

  return port;
}

function readToml(path: string): Record<string, any> {
  try {
    return Bun.TOML.parse(readFileSync(path, "utf8")) as Record<string, any>;
  } catch {
    return {};
  }
}

/**
 * A throwaway config folder plus a way to run the real entry point against
 * fake Slack with piped answers and no browser. Never touches the real config
 * or keychain.
 */
export function createSandbox(): Sandbox {
  const configHome = mkdtempSync(join(tmpdir(), "termslack-run-"));
  const termslackDir = join(configHome, "termslack");
  const configPath = join(termslackDir, "config.toml");
  const stateDir = join(configHome, "state", "termslack");
  const statePath = join(stateDir, "state.toml");
  const credentialsPath = join(termslackDir, "credentials.toml");
  const runs: TermslackRun[] = [];

  return {
    readSecrets: () => JSON.parse(readToml(credentialsPath)[teamId] ?? "{}"),
    readConfig: () => readToml(configPath),
    configText() {
      try {
        return readFileSync(configPath, "utf8");
      } catch {
        return undefined;
      }
    },
    readState: () => readToml(statePath),
    seed({ workspace, configText, state, secrets }) {
      mkdirSync(termslackDir, { recursive: true });

      if (configText !== undefined) {
        writeFileSync(configPath, configText);
      }

      if (state) {
        mkdirSync(stateDir, { recursive: true });
        writeFileSync(statePath, Bun.TOML.stringify(state));
      }

      if (workspace) {
        writeFileSync(
          configPath,
          Bun.TOML.stringify({
            defaultWorkspace: teamId,
            workspaces: { [teamId]: { teamId, ...workspace } },
          }),
        );
      }

      if (secrets) {
        writeFileSync(
          credentialsPath,
          Bun.TOML.stringify({ [teamId]: JSON.stringify(secrets) }),
        );
      }
    },
    async run(
      slack,
      answers = [],
      { args = [], ui = false, env: extraEnv = {} } = {},
    ) {
      let output = "";

      const env: Record<string, string | undefined> = {
        ...process.env,
        XDG_CONFIG_HOME: configHome,
        XDG_STATE_HOME: join(configHome, "state"),
        TERMSLACK_SECRETS_BACKEND: "file",
        TERMSLACK_BROWSER: "none",
        TERMSLACK_SLACK_API_URL: slack.apiUrl,
        TERMSLACK_OAUTH_PORT: String(await freePort()),
      };

      delete env.TERMSLACK_APP_TOKEN;
      delete env.TERMSLACK_USER_TOKEN;

      Object.assign(env, extraEnv);

      const child = Bun.spawn(
        [
          "bun",
          join(import.meta.dir, "../../src/index.ts"),
          ...(ui ? [] : ["--log"]),
          ...args,
        ],
        {
          env,
          stdin: new Blob(answers.map((answer) => `${answer}\n`)),
          stdout: "pipe",
          stderr: "pipe",
        },
      );

      const collect = async (stream: ReadableStream<Uint8Array>) => {
        for await (const chunk of stream) {
          output += new TextDecoder().decode(chunk);
        }
      };

      void collect(child.stdout);
      void collect(child.stderr);

      const waitForOutput = (pattern: RegExp, timeoutMs = 10_000) =>
        waitFor(() => pattern.test(output) && output, timeoutMs);

      const run: TermslackRun = {
        output: () => output,
        exited: child.exited,
        waitForOutput,
        async completeSignIn(code = "auth-code") {
          const printed = await waitForOutput(authorizeUrlPattern);

          const authorizeUrl = new URL(printed.match(authorizeUrlPattern)![0]);
          const callback = new URL(
            authorizeUrl.searchParams.get("redirect_uri") ?? "",
          );

          callback.searchParams.set("code", code);
          callback.searchParams.set(
            "state",
            authorizeUrl.searchParams.get("state") ?? "",
          );

          await fetch(callback);
        },
        async stop() {
          child.kill();
          await child.exited;
        },
      };

      runs.push(run);

      return run;
    },
    async cleanup() {
      await Promise.all(runs.map((run) => run.stop()));

      rmSync(configHome, { recursive: true, force: true });
    },
  };
}
