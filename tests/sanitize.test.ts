import { expect, test } from "bun:test";
import { sanitizeCapture } from "../scripts/lib/sanitize";

const capture = [
  JSON.stringify({
    token: "realtoken",
    team_id: "T05RK3N8WD6",
    event: {
      type: "message",
      channel: "C07MZ2P4HJ5",
      user: "U04QX7M2LP9",
      text: "Lunch with Alice? <@U0AAAAAAAA1> see <https://acme.slack.com/x|the doc>",
      ts: "1700000000.000100",
      channel_type: "channel",
    },
  }),
  "Connecting to Acme...",
  JSON.stringify({
    event: {
      type: "reaction_added",
      user: "U04QX7M2LP9",
      reaction: "tada",
      item: {
        type: "message",
        channel: "C07MZ2P4HJ5",
        ts: "1700000000.000100",
      },
    },
  }),
].join("\n");

test("skips non-JSON lines and keeps one payload per captured body", () => {
  expect(sanitizeCapture(capture)).toHaveLength(2);
});

test("maps the same real value to the same placeholder across payloads", () => {
  const [message, reaction] = sanitizeCapture(capture);

  expect(message?.event.user).toBe(reaction?.event.user);
  expect(message?.event.channel).toBe(reaction?.event.item.channel);
  expect(message?.event.user).not.toBe(message?.event.channel);
});

test("keeps structure and non-identifying fields", () => {
  const [message, reaction] = sanitizeCapture(capture);

  expect(message?.event).toMatchObject({
    type: "message",
    ts: "1700000000.000100",
    channel_type: "channel",
  });
  expect(reaction?.event.reaction).toBe("tada");
});

test("removes real names, text, IDs, tokens and URLs, keeping mention markup valid", () => {
  const output = JSON.stringify(sanitizeCapture(capture));

  for (const secret of [
    "realtoken",
    "T05RK3N8WD6",
    "C07MZ2P4HJ5",
    "U04QX7M2LP9",
    "U0AAAAAAAA1",
    "Lunch",
    "Alice",
    "acme",
    "the doc",
  ]) {
    expect(output).not.toContain(secret);
  }

  const [message] = sanitizeCapture(capture);

  expect(message?.event.text).toMatch(
    /^message text 1 <@U\d{8}> <https:\/\/example\.invalid\/\d+\|name \d+>$/,
  );
});
