import { expect, test } from "bun:test";
import { tagMismatch } from "../scripts/check-tag";
import { homebrewFormula } from "../scripts/homebrew-formula";
import { extractReleaseNotes } from "../scripts/release-notes";

const changelog = `# Changelog

## 0.2.0 - 2026-12-01

- Second.
- Also second.

## 0.1.0 - 2026-11-13

First release.

- One thing.
`;

test("a tag equal to v plus the version passes", () => {
  expect(tagMismatch("v0.1.0", "0.1.0")).toBeNull();
});

test("a mismatched, unprefixed or empty tag fails", () => {
  expect(tagMismatch("v0.1.1", "0.1.0")).toContain("does not match");
  expect(tagMismatch("0.1.0", "0.1.0")).toContain("does not match");
  expect(tagMismatch("", "0.1.0")).toContain("does not match");
});

test("release notes are the section for that version only", () => {
  expect(extractReleaseNotes(changelog, "0.2.0")).toBe(
    "- Second.\n- Also second.",
  );
  expect(extractReleaseNotes(changelog, "0.1.0")).toBe(
    "First release.\n\n- One thing.",
  );
});

test("release notes are null for a missing version", () => {
  expect(extractReleaseNotes(changelog, "0.3.0")).toBeNull();
  expect(extractReleaseNotes(changelog, "0.2")).toBeNull();
});

const sha = (digit: string) => digit.repeat(64);
const checksums = `${sha("a")}  termslack-0.1.0-darwin-arm64.tar.gz
${sha("b")}  termslack-0.1.0-darwin-x64.tar.gz
${sha("c")}  termslack-0.1.0-linux-arm64.tar.gz
${sha("d")}  termslack-0.1.0-linux-x64.tar.gz
`;

test("the formula picks each platform's archive and checksum", () => {
  const formula = homebrewFormula("0.1.0", checksums);

  expect(formula).toContain("class Termslack < Formula");
  expect(formula).toContain('version "0.1.0"');
  expect(formula).toContain('license "MIT"');
  expect(formula).toMatch(
    /on_macos do\n {4}on_arm do\n {6}url "https:\/\/github\.com\/TWithers\/termslack\/releases\/download\/v0\.1\.0\/termslack-0\.1\.0-darwin-arm64\.tar\.gz"\n {6}sha256 "a{64}"/,
  );
  expect(formula).toMatch(/darwin-x64\.tar\.gz"\n {6}sha256 "b{64}"/);
  expect(formula).toMatch(
    /on_linux do\n {4}on_arm do[^]*linux-arm64\.tar\.gz"\n {6}sha256 "c{64}"/,
  );
  expect(formula).toMatch(/linux-x64\.tar\.gz"\n {6}sha256 "d{64}"/);
  expect(formula).toContain('bin.install "termslack"');
  expect(formula).toContain("shell_output");
});

test("the formula refuses checksums that miss a platform", () => {
  const missing = checksums.split("\n").slice(0, 3).join("\n");

  expect(() => homebrewFormula("0.1.0", missing)).toThrow("linux-x64");
  expect(() => homebrewFormula("0.2.0", checksums)).toThrow("0.2.0");
});
