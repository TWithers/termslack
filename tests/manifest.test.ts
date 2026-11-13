import { expect, test } from "bun:test";
import { appName, buildManifest, manifestHash } from "../src/setup/manifest";

test("app name stays within Slack's 35 character limit", () => {
  expect(appName().length).toBeLessThanOrEqual(35);
});

test("manifest hash changes when the manifest changes", () => {
  const original = manifestHash(buildManifest("http://127.0.0.1:1/callback"));

  expect(manifestHash(buildManifest("http://127.0.0.1:1/callback"))).toBe(
    original,
  );
  expect(manifestHash(buildManifest("http://127.0.0.1:2/callback"))).not.toBe(
    original,
  );
});
