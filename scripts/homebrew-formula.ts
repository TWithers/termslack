/**
 * `bun scripts/homebrew-formula.ts <version> <checksums.txt> <out.rb>` writes
 * the Homebrew formula for a release from its checksums file.
 */
import { archiveName, releaseTargets } from "./targets";

const repository = "https://github.com/TWithers/termslack";

/** Maps archive name to sha256 from `<sha256>  <name>` lines. */
export function parseChecksums(text: string): Map<string, string> {
  const checksums = new Map<string, string>();

  for (const line of text.split(/\r?\n/)) {
    const match = line.trim().match(/^([0-9a-f]{64})\s+\*?(\S+)$/i);

    if (match) {
      checksums.set(match[2]!, match[1]!.toLowerCase());
    }
  }

  return checksums;
}

function platformBlock(
  version: string,
  checksums: Map<string, string>,
  os: "darwin" | "linux",
): string {
  const blocks = (["arm64", "x64"] as const).map((arch) => {
    const target = releaseTargets.find(
      (candidate) => candidate.os === os && candidate.arch === arch,
    )!;
    const name = archiveName(version, target);
    const sha256 = checksums.get(name);

    if (!sha256) {
      throw new Error(`checksums.txt has no entry for ${name}`);
    }

    const block = arch === "arm64" ? "on_arm" : "on_intel";

    return [
      `    ${block} do`,
      `      url "${repository}/releases/download/v${version}/${name}"`,
      `      sha256 "${sha256}"`,
      `    end`,
    ].join("\n");
  });

  return blocks.join("\n\n");
}

export function homebrewFormula(
  version: string,
  checksumsText: string,
): string {
  const checksums = parseChecksums(checksumsText);

  return `class Termslack < Formula
  desc "Terminal Slack client: read and write in your channels and DMs from the keyboard"
  homepage "${repository}"
  version "${version}"
  license "MIT"

  on_macos do
${platformBlock(version, checksums, "darwin")}
  end

  on_linux do
${platformBlock(version, checksums, "linux")}
  end

  def install
    bin.install "termslack"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/termslack --version")
  end
end
`;
}

if (import.meta.main) {
  const [version, checksumsPath, outPath] = process.argv.slice(2);

  if (!version || !checksumsPath || !outPath) {
    console.error(
      "Usage: bun scripts/homebrew-formula.ts <version> <checksums.txt> <out.rb>",
    );
    process.exit(1);
  }

  const checksumsText = await Bun.file(checksumsPath).text();

  await Bun.write(outPath, homebrewFormula(version, checksumsText));
  console.log(`Wrote ${outPath}`);
}
