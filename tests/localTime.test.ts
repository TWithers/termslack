import { expect, test } from "bun:test";
import { convertUser } from "../src/slack/convert";
import { clockIn } from "../src/ui/app/paneRows";
import { msUntilNextMinute } from "../src/ui/app/useMinuteRedraw";
import { loadFixture } from "./support/fixtures";

const noon = new Date(Date.UTC(2026, 10, 9, 12, 0, 0));

test("a user's time zone name and offset come from users.info", async () => {
  const [info] = await loadFixture("users-info");
  const user = convertUser(info?.user);

  expect(user?.timeZone).toBe("America/Los_Angeles");
  expect(user?.timeZoneOffset).toBe(-25200);
});

test("a user without time zone fields has none", () => {
  const user = convertUser({ id: "U1", name: "someone" });

  expect(user).not.toHaveProperty("timeZone");
  expect(user).not.toHaveProperty("timeZoneOffset");
});

test("the local time follows the zone name, in the message list's 24-hour form", () => {
  expect(clockIn(noon, { timeZone: "America/Chicago" })).toBe("06:00");
  expect(clockIn(noon, { timeZone: "Asia/Kolkata" })).toBe("17:30");
});

test("the offset is used when there is no zone name or it is unknown", () => {
  expect(clockIn(noon, { timeZoneOffset: -21600 })).toBe("06:00");
  expect(clockIn(noon, { timeZone: "Not/AZone", timeZoneOffset: 19800 })).toBe(
    "17:30",
  );
});

test("there is no local time without a zone or an offset", () => {
  expect(clockIn(noon, {})).toBeUndefined();
});

test("the minute redraw waits for the start of the next minute", () => {
  expect(
    msUntilNextMinute(new Date(Date.UTC(2026, 10, 9, 12, 0, 15, 250))),
  ).toBe(44_750);
});
