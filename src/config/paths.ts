import { homedir } from "node:os";
import { join } from "node:path";

const configHome = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");

export const configDir = join(configHome, "termslack");

export const configFile = join(configDir, "config.toml");

export const credentialsFile = join(configDir, "credentials.toml");

const stateHome =
  process.env.XDG_STATE_HOME || join(homedir(), ".local", "state");

/** Things termslack remembers on its own (not user-edited), like the last open conversation. */
export const stateDir = join(stateHome, "termslack");

export const stateFile = join(stateDir, "state.toml");
