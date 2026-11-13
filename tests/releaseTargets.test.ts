import { expect, test } from "bun:test";
import { archiveName, checksumsText, releaseTargets } from "../scripts/targets";

test("release targets are macOS and Linux on arm64 and x64", () => {
  const names = releaseTargets.map((target) => archiveName("0.1.0", target));

  expect(names).toEqual([
    "termslack-0.1.0-darwin-arm64.tar.gz",
    "termslack-0.1.0-darwin-x64.tar.gz",
    "termslack-0.1.0-linux-arm64.tar.gz",
    "termslack-0.1.0-linux-x64.tar.gz",
  ]);
});

test("each target maps to a Bun compile target", () => {
  for (const target of releaseTargets) {
    expect(target.bunTarget).toBe(`bun-${target.os}-${target.arch}`);
  }
});

test("checksum lines are sorted and sha256sum compatible", () => {
  const text = checksumsText([
    { name: "b.tar.gz", sha256: "bb" },
    { name: "a.tar.gz", sha256: "aa" },
  ]);

  expect(text).toBe("aa  a.tar.gz\nbb  b.tar.gz\n");
});
