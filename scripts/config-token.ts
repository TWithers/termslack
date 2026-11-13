import { loadConfig } from "../src/config/config";
import { loadSecrets } from "../src/config/secrets";
import { freshConfigToken } from "../src/slack/configToken";

/**
 * Prints a valid app configuration token for the default workspace, rotating
 * (and saving) it first if it has expired. Used by `bun run test:live`.
 */
const teamId = (await loadConfig()).defaultWorkspace;

if (!teamId) {
  console.error("No workspace configured. Run `bun start` first.");
  process.exit(1);
}

console.log(await freshConfigToken(teamId, await loadSecrets(teamId)));
