import packageJson from "../package.json";

/**
 * termslack's version, read from `package.json`. Importing the JSON lets
 * `bun build --compile` bundle the value into the binary, so a built binary and
 * `bun src/index.ts` report the same version.
 */
export const version: string = packageJson.version;
