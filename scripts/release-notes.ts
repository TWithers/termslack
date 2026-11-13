/**
 * `bun scripts/release-notes.ts 0.1.0 [out.md]` writes that version's section
 * of CHANGELOG.md (without its heading) to out.md, or stdout.
 */

/** The body under `## <version> ...`, up to the next `## ` heading; null when there is none. */
export function extractReleaseNotes(
  changelog: string,
  version: string,
): string | null {
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex((line) => {
    const heading = line.match(/^##\s+\[?([^\s\]]+)\]?/);

    return heading !== null && heading[1] === version;
  });

  if (start === -1) {
    return null;
  }

  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^##\s/.test(line));
  const body = (end === -1 ? rest : rest.slice(0, end)).join("\n").trim();

  return body === "" ? null : body;
}

if (import.meta.main) {
  const [version, outPath] = process.argv.slice(2);

  if (!version) {
    console.error("Usage: bun scripts/release-notes.ts <version> [out.md]");
    process.exit(1);
  }

  const notes = extractReleaseNotes(
    await Bun.file("CHANGELOG.md").text(),
    version,
  );

  if (notes === null) {
    console.error(`CHANGELOG.md has no section with notes for ${version}.`);
    process.exit(1);
  }

  if (outPath) {
    await Bun.write(outPath, `${notes}\n`);
  } else {
    console.log(notes);
  }
}
