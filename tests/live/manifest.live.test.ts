import { describe, expect, test } from "bun:test";
import { buildManifest } from "../../src/setup/manifest";
import { slackClient } from "../../src/slack/client";
import { redirectUri } from "../../src/slack/oauth";

/**
 * Talks to real Slack. Skipped unless TERMSLACK_CONFIG_TOKEN is set; `bun run
 * test:live` fills it in from your stored workspace.
 */
const configToken = process.env.TERMSLACK_CONFIG_TOKEN;

describe.skipIf(!configToken)("live Slack", () => {
  test("Slack accepts the app manifest", async () => {
    const result = await slackClient(configToken)
      .apps.manifest.validate({ manifest: buildManifest(redirectUri) })
      .catch((error) => error.data);

    expect(result).toMatchObject({ ok: true });
  });
});
