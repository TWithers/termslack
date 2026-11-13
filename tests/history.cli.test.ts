import { afterEach, beforeEach, expect, test } from "bun:test";
import { type FakeSlack, startFakeSlack } from "./support/fakeSlack";
import { loadFixture } from "./support/fixtures";
import {
  createSandbox,
  type Sandbox,
  type TermslackRun,
} from "./support/termslack";

let slack: FakeSlack;
let sandbox: Sandbox;

beforeEach(async () => {
  slack = startFakeSlack();
  sandbox = createSandbox();

  slack.respondPaged(
    "users.conversations",
    await loadFixture("users-conversations-channels").then(async (channels) => [
      ...channels,
      ...(await loadFixture("users-conversations-dms")),
    ]),
  );
  slack.respondPaged("users.list", await loadFixture("users-list"));
  slack.respondPaged(
    "conversations.history",
    await loadFixture("conversations-history"),
  );
});

afterEach(async () => {
  await sandbox.cleanup();
  await slack.stop();
});

const plain = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, "");

function runHistory(reference: string): Promise<TermslackRun> {
  return sandbox.run(slack, [], {
    args: ["--history", reference],
    env: {
      TERMSLACK_APP_TOKEN: "xapp-test",
      TERMSLACK_USER_TOKEN: "xoxp-test",
    },
  });
}

for (const [reference, channelId] of [
  ["general", "C012AB3CD"],
  ["#general", "C012AB3CD"],
  ["C012AB3CD", "C012AB3CD"],
] as const) {
  test(`--history ${reference} prints recent history oldest first, then goes live`, async () => {
    const run = await runHistory(reference);

    const output = plain(await run.waitForOutput(/Live events:/));
    const lines = output.split("\n");
    const at = (text: string) => lines.findIndex((line) => line.includes(text));

    expect(at("Deploy finished")).toBeGreaterThan(-1);
    expect(at("Deploy finished")).toBeLessThan(at("any plans"));
    expect(at("any plans")).toBeLessThan(at("smell my shoes"));
    expect(at("smell my shoes")).toBeLessThan(at("Live events:"));

    expect(lines[at("any plans")]).toMatch(
      /message +#general egon \[2 replies\]: @Peter Venkman any plans/,
    );
    expect(lines[at("smell my shoes")]).toMatch(
      /message +#general Peter Venkman: What/,
    );
    expect(
      slack.calls.find((call) => call.method === "conversations.history")
        ?.params,
    ).toMatchObject({ channel: channelId });

    slack.send({
      type: "events_api",
      envelope_id: "live-1",
      payload: {
        event: {
          type: "message",
          channel: channelId,
          user: "U123ABC456",
          text: "a live one",
          ts: "1512200000.000001",
        },
      },
      accepts_response_payload: false,
    });

    expect(plain(await run.waitForOutput(/a live one/))).toMatch(
      /Live events:[\s\S]*a live one/,
    );
  });
}

test("--history @name reads the DM with that person", async () => {
  const run = await runHistory("@venkman");

  await run.waitForOutput(/Live events:/);

  expect(
    slack.calls.find((call) => call.method === "conversations.history")?.params
      .channel,
  ).toBe("D0C0F7S8Y");
});

test("an unknown channel name fails with close matches and no stack trace", async () => {
  const run = await runHistory("gneral");

  expect(await run.exited).toBe(1);

  const output = plain(run.output());

  expect(output).toContain("✗ No channel named");
  expect(output).toContain("Did you mean: #general");
  expect(output).not.toMatch(/\n\s+at /);
  expect(
    slack.calls.filter((call) => call.method === "conversations.history"),
  ).toHaveLength(0);
});

test("a DM that doesn't exist fails clearly", async () => {
  const run = await runHistory("@egon");

  expect(await run.exited).toBe(1);
  expect(plain(run.output())).toContain("no direct message");
});

test("a conversation Slack refuses fails with Slack's reason", async () => {
  slack.respond("conversations.history", () => ({
    ok: false,
    error: "channel_not_found",
  }));

  const run = await runHistory("C999999999");

  expect(await run.exited).toBe(1);
  expect(plain(run.output())).toContain("channel_not_found");
  expect(run.output()).not.toMatch(/\n\s+at /);
});

test("--history without a channel fails with usage", async () => {
  const run = await sandbox.run(slack, [], {
    args: ["--history"],
    env: {
      TERMSLACK_APP_TOKEN: "xapp-test",
      TERMSLACK_USER_TOKEN: "xoxp-test",
    },
  });

  expect(await run.exited).toBe(1);
  expect(plain(run.output())).toContain("--history needs a channel");
});
