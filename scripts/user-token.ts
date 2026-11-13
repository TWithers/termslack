import { loadConfig } from "../src/config/config";
import { loadSecrets } from "../src/config/secrets";

/**
 * Prints the stored user token for the default workspace. Used by `bun run
 * test:live`.
 */
const teamId = (await loadConfig()).defaultWorkspace;

if (!teamId) {
  console.error("No workspace configured. Run `bun start` first.");
  process.exit(1);
}

const { userToken } = await loadSecrets(teamId);

if (!userToken) {
  console.error("No user token stored. Run `bun start` to sign in.");
  process.exit(1);
}

console.log(userToken);
