import { expect, test } from "bun:test";
import { convertEnvelope, convertUserGroups } from "../src/slack/convert";
import { loadFixture } from "./support/fixtures";

async function convertFixture(index: number) {
  const payloads = await loadFixture("subteam-events");

  return convertEnvelope("events_api", payloads[index]!);
}

test("subteam_members_changed lists who was added and removed", async () => {
  expect(await convertFixture(0)).toMatchObject({
    kind: "userGroup",
    action: "membersChanged",
    userGroupId: "S0615G0KT",
    addedUserIds: ["U222222222"],
    removedUserIds: ["U333333333"],
    issues: [],
  });
});

test("subteam_self_added and subteam_self_removed are about the current user", async () => {
  expect(await convertFixture(1)).toMatchObject({
    kind: "userGroup",
    action: "selfAdded",
    userGroupId: "S0615G0KT",
    addedUserIds: [],
  });
  expect(await convertFixture(2)).toMatchObject({
    action: "selfRemoved",
  });
});

test("a subteam event without a group ID reports the gap", () => {
  const event = convertEnvelope("events_api", {
    event: { type: "subteam_self_added" },
  });

  expect(event).toMatchObject({ kind: "userGroup", userGroupId: "" });
  expect(event.issues).toContain("missing subteam_id");
});

test("usergroups.list keeps the users when Slack included them, and none when it didn't", () => {
  const groups = convertUserGroups({
    usergroups: [
      { id: "S1", handle: "a", users: ["U1", "U2"] },
      { id: "S2", handle: "b" },
    ],
  });

  expect(groups.map((group) => group.userIds)).toEqual([
    ["U1", "U2"],
    undefined,
  ]);
});
