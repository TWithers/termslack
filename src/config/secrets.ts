import { readToml, writeTomlAtomic } from "./files";
import { credentialsFile } from "./paths";

const service = "termslack";

export type WorkspaceSecrets = {
  configToken?: string;
  configRefreshToken?: string;
  configTokenExpiresAt?: number;
  clientSecret?: string;
  appToken?: string;
  userToken?: string;
};

type SecretsBackend = {
  name: string;
  get(teamId: string): Promise<string | null>;
  set(teamId: string, value: string): Promise<void>;
  delete(teamId: string): Promise<void>;
};

const keychainBackend: SecretsBackend = {
  name: "OS keychain",
  get: (teamId) => Bun.secrets.get({ service, name: teamId }),
  set: (teamId, value) => Bun.secrets.set({ service, name: teamId, value }),
  delete: async (teamId) => {
    await Bun.secrets.delete({ service, name: teamId });
  },
};

/**
 * Plaintext fallback for machines without a credential store (headless Linux,
 * SSH sessions, containers). The file is 0600, same approach the gh CLI takes.
 */
const fileBackend: SecretsBackend = {
  name: credentialsFile,
  get: async (teamId) => {
    const all = await readToml<Record<string, string>>(credentialsFile, {});

    return all[teamId] ?? null;
  },
  set: async (teamId, value) => {
    const all = await readToml<Record<string, string>>(credentialsFile, {});

    all[teamId] = value;

    await writeTomlAtomic(credentialsFile, all);
  },
  delete: async (teamId) => {
    const all = await readToml<Record<string, string>>(credentialsFile, {});

    delete all[teamId];

    await writeTomlAtomic(credentialsFile, all);
  },
};

let backend: SecretsBackend | undefined;

async function resolveBackend(): Promise<SecretsBackend> {
  if (backend) {
    return backend;
  }

  if (process.env.TERMSLACK_SECRETS_BACKEND === "file") {
    backend = fileBackend;

    return backend;
  }

  try {
    await Bun.secrets.get({ service, name: "__probe__" });
    backend = keychainBackend;
  } catch {
    console.warn(
      `⚠ No OS credential store available. Storing tokens in ${credentialsFile} (mode 0600).`,
    );
    backend = fileBackend;
  }

  return backend;
}

export async function loadSecrets(teamId: string): Promise<WorkspaceSecrets> {
  const raw = await (await resolveBackend()).get(teamId);

  return raw ? (JSON.parse(raw) as WorkspaceSecrets) : {};
}

export async function updateSecrets(
  teamId: string,
  changes: WorkspaceSecrets,
): Promise<WorkspaceSecrets> {
  const secrets = { ...(await loadSecrets(teamId)), ...changes };

  await (await resolveBackend()).set(teamId, JSON.stringify(secrets));

  return secrets;
}

export async function deleteSecrets(teamId: string): Promise<void> {
  await (await resolveBackend()).delete(teamId);
}
