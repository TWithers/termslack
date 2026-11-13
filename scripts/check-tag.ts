/**
 * `bun scripts/check-tag.ts v0.1.0` exits 1 unless the tag (without the `v`)
 * equals package.json's version. Defaults to $GITHUB_REF_NAME.
 */
import packageJson from "../package.json";

/** Returns an error message when the tag doesn't match the version, otherwise null. */
export function tagMismatch(tag: string, version: string): string | null {
  if (tag === `v${version}`) {
    return null;
  }

  return `Tag "${tag}" does not match package.json version ${version} (expected "v${version}").`;
}

if (import.meta.main) {
  const tag = process.argv[2] ?? process.env.GITHUB_REF_NAME ?? "";
  const problem = tagMismatch(tag, packageJson.version);

  if (problem) {
    console.error(problem);
    process.exit(1);
  }

  console.log(`Tag ${tag} matches package.json.`);
}
