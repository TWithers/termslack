import { afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Runs before any test file is loaded, so config paths resolve to a throwaway
 * directory. Tests never touch the real config, keychain or browser.
 */
const configHome = mkdtempSync(join(tmpdir(), "termslack-test-"));

process.env.XDG_CONFIG_HOME = configHome;
process.env.XDG_STATE_HOME = join(configHome, "state");
process.env.TERMSLACK_SECRETS_BACKEND = "file";
process.env.TERMSLACK_BROWSER = "none";

afterAll(() => {
  rmSync(configHome, { recursive: true, force: true });
});
