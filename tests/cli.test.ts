import { expect, test } from "bun:test";
import { helpText, parseArgs, versionText } from "../src/cli";
import packageJson from "../package.json";

async function runCli(...args: string[]) {
  const child = Bun.spawn(["bun", "src/index.ts", ...args], {
    cwd: `${import.meta.dir}/..`,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);

  return { stdout, stderr, code };
}

test("package.json is at the current release version", () => {
  expect(packageJson.version).toBe("0.2.1");
  expect(versionText).toBe("termslack 0.2.1");
});

test("--version and -v ask for the version", () => {
  expect(parseArgs(["--version"])).toEqual({ action: "version" });
  expect(parseArgs(["-v"])).toEqual({ action: "version" });
});

test("--help and -h ask for the help, even next to other options", () => {
  expect(parseArgs(["--help"])).toEqual({ action: "help" });
  expect(parseArgs(["-h"])).toEqual({ action: "help" });
  expect(parseArgs(["--log", "--help"])).toEqual({ action: "help" });
});

test("the help lists every option the command line handles", () => {
  for (const option of ["--log", "--raw", "--history", "--version", "--help"]) {
    expect(helpText).toContain(option);
  }
});

test("the help points to the project page", () => {
  expect(helpText.split("\n").at(-1)).toBe(
    "More: https://github.com/TWithers/termslack",
  );
});

test("no arguments is a normal run", () => {
  expect(parseArgs([])).toEqual({
    action: "run",
    options: { raw: false, log: false, history: undefined },
  });
});

test("--raw and --history imply --log", () => {
  expect(parseArgs(["--raw"])).toMatchObject({
    action: "run",
    options: { raw: true, log: true },
  });
  expect(parseArgs(["--history", "general"])).toMatchObject({
    action: "run",
    options: { log: true, history: "general" },
  });
  expect(parseArgs(["--history=#general"])).toMatchObject({
    action: "run",
    options: { log: true, history: "#general" },
  });
});

test("--history without a channel is an error", () => {
  expect(parseArgs(["--history"]).action).toBe("error");
  expect(parseArgs(["--history", "--log"]).action).toBe("error");
});

test("an unknown option is an error that names it", () => {
  expect(parseArgs(["--bogus"])).toMatchObject({
    action: "error",
    message: expect.stringContaining("--bogus"),
  });
});

test("--version prints the version and exits 0", async () => {
  const { stdout, code } = await runCli("--version");

  expect(code).toBe(0);
  expect(stdout.trim()).toBe(`termslack ${packageJson.version}`);
});

test("--help prints usage and exits 0", async () => {
  const { stdout, code } = await runCli("--help");

  expect(code).toBe(0);
  expect(stdout).toContain("Usage:");
  expect(stdout).toContain("--log");
});

test("an unknown option points to --help and exits non-zero", async () => {
  const { stdout, stderr, code } = await runCli("--bogus");

  expect(code).not.toBe(0);
  expect(stdout).toBe("");
  expect(stderr).toContain("--bogus");
  expect(stderr).toContain("--help");
});
