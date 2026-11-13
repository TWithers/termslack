import type { WebClient } from "@slack/web-api";
import type { Bot, User, UserGroup } from "../session/events";
import type { LookupResult } from "../session/nameResolver";
import {
  convertBot,
  convertUser,
  convertUserGroups,
  convertUsersPage,
  type UsersPage,
} from "./convert";
import { lookup } from "./lookup";

const noSuchBotErrors = new Set(["bot_not_found"]);
const noSuchUserErrors = new Set(["user_not_found", "user_not_visible"]);

/** Looks up a single user; not found and not visible are definite answers. */
export async function fetchUser(
  client: WebClient,
  id: string,
): Promise<LookupResult<User>> {
  return lookup(
    async () => convertUser((await client.users.info({ user: id })).user),
    noSuchUserErrors,
  );
}

/** One page of everyone in the workspace. Rejects with Slack's error. */
export async function fetchUsersPage(
  client: WebClient,
  cursor?: string,
): Promise<UsersPage> {
  return convertUsersPage(await client.users.list({ limit: 200, cursor }));
}

/** Looks up a bot or integration; `bot_not_found` is a definite answer. */
export async function fetchBot(
  client: WebClient,
  id: string,
): Promise<LookupResult<Bot>> {
  return lookup(
    async () => convertBot((await client.bots.info({ bot: id })).bot),
    noSuchBotErrors,
  );
}

const noGroupAccessErrors = new Set([
  "missing_scope",
  "not_allowed_token_type",
]);

/**
 * Every user group in the workspace, with who is in each (one call, where
 * `usergroups.users.list` would take one per group). Slack has no
 * single-group lookup, so the whole list is fetched; a missing scope is a
 * definite answer.
 */
export async function fetchUserGroups(
  client: WebClient,
): Promise<LookupResult<UserGroup[]>> {
  return lookup(
    async () =>
      convertUserGroups(await client.usergroups.list({ include_users: true })),
    noGroupAccessErrors,
  );
}
