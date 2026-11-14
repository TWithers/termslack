import type { Bot, User, UserGroup, UserStatus } from "../../session/events";
import { isObject, optionalString, presentString } from "./shared";

/**
 * Turns a user object from `users.info`, `users.list` or a user event into
 * termslack's own type. Only fields the payload mentions are set, so a partial
 * profile event can be merged over what the store already has. Returns
 * undefined when it has no usable ID.
 */
export function convertUser(raw: unknown): User | undefined {
  if (!isObject(raw) || typeof raw.id !== "string" || raw.id === "") {
    return undefined;
  }

  const profile = isObject(raw.profile) ? raw.profile : {};
  const hasStatus = "status_text" in profile || "status_emoji" in profile;
  const status: UserStatus | undefined = hasStatus
    ? {
        emoji: presentString(profile.status_emoji) ?? "",
        text: presentString(profile.status_text) ?? "",
      }
    : undefined;
  const user: User = {
    id: raw.id,
    name: optionalString(raw.name),
    realName: presentString(profile.real_name) ?? presentString(raw.real_name),
    displayName: presentString(profile.display_name),
    isBot: typeof raw.is_bot === "boolean" ? raw.is_bot : undefined,
    isDeleted: typeof raw.deleted === "boolean" ? raw.deleted : undefined,
    status,
    color: hexColour(raw.color),
    timeZone: presentString(raw.tz),
    timeZoneOffset:
      typeof raw.tz_offset === "number" && Number.isFinite(raw.tz_offset)
        ? raw.tz_offset
        : undefined,
  };

  return Object.fromEntries(
    Object.entries(user).filter(([, value]) => value !== undefined),
  ) as User;
}

/** Slack's `color` (`9f69e7`, no `#`) as `#rrggbb`; undefined when it isn't six hex digits. */
function hexColour(value: unknown): string | undefined {
  return typeof value === "string" && /^#?[0-9a-f]{6}$/i.test(value)
    ? `#${value.replace("#", "").toLowerCase()}`
    : undefined;
}

export type UsersPage = {
  users: User[];
  /** Cursor for the next page; undefined on the last one. */
  nextCursor?: string;
  issues: string[];
};

/** Reads one page of `users.list`. */
export function convertUsersPage(response: Record<string, any>): UsersPage {
  const issues: string[] = [];
  const entries = Array.isArray(response.members) ? response.members : [];

  if (!Array.isArray(response.members)) {
    issues.push("missing members");
  }

  const users: User[] = [];

  for (const entry of entries) {
    const user = convertUser(entry);

    if (user) {
      users.push(user);
    } else {
      issues.push("skipped a user without an id");
    }
  }

  return {
    users,
    nextCursor: optionalString(response.response_metadata?.next_cursor),
    issues,
  };
}

/** Turns the `bot` object from `bots.info` into termslack's own type; undefined without an ID or name. */
export function convertBot(raw: unknown): Bot | undefined {
  if (!isObject(raw) || typeof raw.id !== "string" || raw.id === "") {
    return undefined;
  }

  const name = optionalString(raw.name);

  if (!name) {
    return undefined;
  }

  return { id: raw.id, name, userId: optionalString(raw.user_id) };
}

/** The user groups from `usergroups.list`; entries without an ID or handle are skipped. */
export function convertUserGroups(response: Record<string, any>): UserGroup[] {
  const entries = Array.isArray(response.usergroups) ? response.usergroups : [];
  const groups: UserGroup[] = [];

  for (const entry of entries) {
    if (!isObject(entry) || typeof entry.id !== "string" || entry.id === "") {
      continue;
    }

    const handle = optionalString(entry.handle);

    if (handle) {
      groups.push({
        id: entry.id,
        handle,
        name: optionalString(entry.name),
        userIds: Array.isArray(entry.users)
          ? entry.users.filter((id: unknown) => typeof id === "string")
          : undefined,
      });
    }
  }

  return groups;
}

/** The ID of the user a token belongs to, from `auth.test`; undefined when the response has none. */
export function convertCurrentUserId(
  response: Record<string, any>,
): string | undefined {
  return optionalString(response.user_id);
}

/** The scopes the token was granted, from `auth.test`; undefined when Slack didn't say. */
export function convertGrantedScopes(
  response: Record<string, any>,
): string[] | undefined {
  const scopes = response.response_metadata?.scopes;

  return Array.isArray(scopes)
    ? scopes.filter((scope: unknown) => typeof scope === "string")
    : undefined;
}
