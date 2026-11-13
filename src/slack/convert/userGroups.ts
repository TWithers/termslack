import type { SlackEvent, UserGroupAction } from "../../session/events";
import { required, timestampOf } from "./shared";

const actions: Record<string, UserGroupAction> = {
  subteam_members_changed: "membersChanged",
  subteam_self_added: "selfAdded",
  subteam_self_removed: "selfRemoved",
};

function userIds(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((id): id is string => typeof id === "string" && id !== "")
    : [];
}

/** `subteam_members_changed`, `subteam_self_added` and `subteam_self_removed`. */
export function convertUserGroupEvent(
  body: Record<string, any>,
  event: Record<string, any>,
): SlackEvent {
  const issues: string[] = [];
  const action = actions[String(event.type)]!;

  return {
    kind: "userGroup",
    action,
    eventType: String(event.type),
    userGroupId: required(event, "subteam_id", issues),
    addedUserIds: userIds(event.added_users),
    removedUserIds: userIds(event.removed_users),
    timestamp: timestampOf(event),
    raw: body,
    issues,
  };
}
