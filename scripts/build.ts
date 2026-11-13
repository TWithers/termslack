/**
 * `bun run build`          single binary for this machine at dist/termslack.
 * `bun run build:release`  one archive per platform plus checksums.txt in dist/release/.
 *
 * Ink loads `react-devtools-core` only when DEV=true and the package is
 * installed, but the bundler still follows that import. Swap it for an empty
 * module so the build doesn't need a package termslack never uses.
 */
import { rm, mkdir } from "node:fs/promises";
import packageJson from "../package.json";
import { archiveName, checksumsText, releaseTargets } from "./targets";

async function compile(outfile: string, target?: string): Promise<void> {
  const result = await Bun.build({
    entrypoints: ["src/index.ts"],
    compile: target
      ? { outfile, target: target as Bun.Build.CompileTarget }
      : { outfile },
    plugins: [
      {
        name: "skip-react-devtools",
        setup(build) {
          build.onResolve({ filter: /^react-devtools-core$/ }, () => ({
            path: "react-devtools-core",
            namespace: "skipped",
          }));
          build.onLoad({ filter: /.*/, namespace: "skipped" }, () => ({
            contents: "export default {};",
            loader: "js",
          }));
        },
      },
    ],
  });

  if (!result.success) {
    for (const log of result.logs) {
      console.error(log);
    }

    process.exit(1);
  }
}

async function buildRelease(): Promise<void> {
  const releaseDir = "dist/release";
  const stagingDir = "dist/release-staging";
  const entries: { name: string; sha256: string }[] = [];

  await rm(releaseDir, { recursive: true, force: true });
  await rm(stagingDir, { recursive: true, force: true });
  await mkdir(releaseDir, { recursive: true });

  for (const target of releaseTargets) {
    const dir = `${stagingDir}/${target.os}-${target.arch}`;
    const name = archiveName(packageJson.version, target);

    console.log(`Building ${name}...`);
    await compile(`${dir}/termslack`, target.bunTarget);

    if (target.os === process.platform && target.arch === process.arch) {
      await checkRuns(`${dir}/termslack`);
    }

    await Bun.$`tar -czf ${releaseDir}/${name} -C ${dir} termslack`;

    const hasher = new Bun.CryptoHasher("sha256");
    hasher.update(await Bun.file(`${releaseDir}/${name}`).bytes());
    entries.push({ name, sha256: hasher.digest("hex") });
  }

  await Bun.write(`${releaseDir}/checksums.txt`, checksumsText(entries));
  await rm(stagingDir, { recursive: true, force: true });
  console.log(
    `Wrote ${entries.length} archives and checksums.txt to ${releaseDir}/`,
  );
}

/** Runs a binary built for this machine and fails the build unless it reports this version. */
async function checkRuns(binary: string): Promise<void> {
  const expected = `termslack ${packageJson.version}`;
  const output = (await Bun.$`${binary} --version`.text()).trim();

  if (output !== expected) {
    console.error(`${binary} --version printed "${output}", expected "${expected}"`);
    process.exit(1);
  }

  console.log(`Checked ${binary}: ${output}`);
}

if (process.argv.includes("--release")) {
  await buildRelease();
} else {
  await compile("dist/termslack");
  await checkRuns("dist/termslack");
}
