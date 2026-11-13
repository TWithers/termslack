import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { logMessage, logSlackEvent } from "../src/ui/eventLog";
import { convertEnvelope } from "../src/slack/convert";
import { loadPayload } from "./support/fixtures";

let lines: string[];
let spy: ReturnType<typeof spyOn>;

beforeEach(() => {
  lines = [];
  spy = spyOn(console, "log").mockImplementation((line: string) => {
    lines.push(line);
  });
});

afterEach(() => spy.mockRestore());

const plain = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, "");

async function logged(fixture: string, raw = false): Promise<string> {
  logSlackEvent(convertEnvelope("events_api", await loadPayload(fixture)), raw);

  return plain(lines.at(-1) ?? "");
}

test("formats messages, edits, deletes and reactions as before", async () => {
  expect(await logged("message")).toMatch(
    / message +#C123ABC456 U123ABC456: Hello world$/,
  );
  expect(await logged("message-changed")).toMatch(
    / message +C123ABC456 U123ABC456 edited: Hello, world!$/,
  );
  expect(await logged("message-deleted")).toMatch(
    / message +C123ABC456 message 1358878749.000002 deleted$/,
  );
  expect(await logged("reaction-added")).toMatch(
    / reaction_added +C123ABC456 U123ABC456 \+👍 on 1360782400.498405$/,
  );
});

test("prints unrecognized events as raw event JSON", () => {
  const event = { type: "pin_added", user: "U1" };

  logSlackEvent(convertEnvelope("events_api", { event }), false);

  expect(plain(lines[0] ?? "")).toMatch(
    new RegExp(`pin_added +${JSON.stringify(event).replace(/[{}]/g, "\\$&")}$`),
  );
});

test("--raw prints the envelope body unchanged", async () => {
  const payload = await loadPayload("message");

  expect(await logged("message", true)).toBe(JSON.stringify(payload));
});

test("a stored message prints exactly like its live event, plus a reply count for thread parents", async () => {
  const event = convertEnvelope("events_api", await loadPayload("message"));

  logSlackEvent(event, false);

  if (event.kind !== "message") {
    throw new Error("expected a message event");
  }

  logMessage({ ...event, isEdited: false, isDeleted: false });
  logMessage({ ...event, replyCount: 1, isEdited: false, isDeleted: false });

  expect(plain(lines[1] ?? "")).toBe(plain(lines[0] ?? ""));
  expect(plain(lines[2] ?? "")).toContain("U123ABC456 [1 reply]: Hello world");
});
