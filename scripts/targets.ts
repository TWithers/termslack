export interface ReleaseTarget {
  os: "darwin" | "linux";
  arch: "arm64" | "x64";
  /** The `compile.target` Bun expects. Linux is glibc; musl would be `bun-linux-<arch>-musl`. */
  bunTarget: string;
}

export const releaseTargets: ReleaseTarget[] = [
  { os: "darwin", arch: "arm64", bunTarget: "bun-darwin-arm64" },
  { os: "darwin", arch: "x64", bunTarget: "bun-darwin-x64" },
  { os: "linux", arch: "arm64", bunTarget: "bun-linux-arm64" },
  { os: "linux", arch: "x64", bunTarget: "bun-linux-x64" },
];

export function archiveName(version: string, target: ReleaseTarget): string {
  return `termslack-${version}-${target.os}-${target.arch}.tar.gz`;
}

/** One `sha256sum -c` / `shasum -a 256 -c` compatible line per archive, ending in a newline. */
export function checksumsText(
  entries: { name: string; sha256: string }[],
): string {
  return entries
    .toSorted((a, b) => a.name.localeCompare(b.name))
    .map((entry) => `${entry.sha256}  ${entry.name}\n`)
    .join("");
}
