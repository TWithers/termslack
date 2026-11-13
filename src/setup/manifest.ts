import { userInfo } from "node:os";
import type { AppsManifestCreateArguments } from "@slack/web-api";

type Manifest = AppsManifestCreateArguments["manifest"];

type UserScope = NonNullable<
  NonNullable<NonNullable<Manifest["oauth_config"]>["scopes"]>["user"]
>[number];

type UserEvent = NonNullable<
  NonNullable<
    NonNullable<Manifest["settings"]>["event_subscriptions"]
  >["user_events"]
>[number];

/**
 * Every user-relevant Events API subscription and the scope(s) it needs.
 * Scopes are derived from this map so the two can't drift apart.
 * Events arrive only for conversations the user is a member of.
 */
const eventScopes: Partial<Record<UserEvent, UserScope[]>> = {
  "message.channels": ["channels:history"],
  "message.groups": ["groups:history"],
  "message.im": ["im:history"],
  "message.mpim": ["mpim:history"],

  reaction_added: ["reactions:read"],
  reaction_removed: ["reactions:read"],
  pin_added: ["pins:read"],
  pin_removed: ["pins:read"],
  star_added: ["stars:read"],
  star_removed: ["stars:read"],

  channel_archive: ["channels:read"],
  channel_created: ["channels:read"],
  channel_deleted: ["channels:read"],
  channel_history_changed: ["channels:history"],
  channel_id_changed: ["channels:read"],
  channel_left: ["channels:read"],
  channel_rename: ["channels:read"],
  channel_shared: ["channels:read"],
  channel_unarchive: ["channels:read"],
  channel_unshared: ["channels:read"],
  member_joined_channel: ["channels:read", "groups:read"],
  member_left_channel: ["channels:read", "groups:read"],

  group_archive: ["groups:read"],
  group_close: ["groups:read"],
  group_deleted: ["groups:read"],
  group_history_changed: ["groups:history"],
  group_left: ["groups:read"],
  group_open: ["groups:read"],
  group_rename: ["groups:read"],
  group_unarchive: ["groups:read"],

  im_close: ["im:read"],
  im_created: ["im:read"],
  im_history_changed: ["im:history"],
  im_open: ["im:read"],

  file_change: ["files:read"],
  file_created: ["files:read"],
  file_deleted: ["files:read"],
  file_public: ["files:read"],
  file_shared: ["files:read"],
  file_unshared: ["files:read"],

  team_join: ["users:read"],
  user_change: ["users:read"],
  user_profile_changed: ["users:read"],
  user_status_changed: ["users:read"],
  user_huddle_changed: ["users:read"],
  dnd_updated: ["dnd:read"],
  dnd_updated_user: ["dnd:read"],

  subteam_created: ["usergroups:read"],
  subteam_members_changed: ["usergroups:read"],
  subteam_self_added: ["usergroups:read"],
  subteam_self_removed: ["usergroups:read"],
  subteam_updated: ["usergroups:read"],

  emoji_changed: ["emoji:read"],
  team_domain_change: ["team:read"],
  team_rename: ["team:read"],
  email_domain_changed: ["team:read"],
};

/** Scopes for API calls rather than event delivery (sending, listing, name lookups). */
const apiScopes: UserScope[] = [
  "chat:write",
  "channels:read",
  "groups:read",
  "im:read",
  "mpim:read",
  "users:read",
  // Requested now for phases 3-4 (reacting, starting DMs, joining and
  // archiving, search) so signing in again is a one-time cost.
  "reactions:write",
  "im:write",
  "mpim:write",
  "channels:write",
  "groups:write",
  "search:read",
];

export const userEvents = Object.keys(eventScopes) as UserEvent[];

export const userScopes: UserScope[] = [
  ...new Set([...apiScopes, ...Object.values(eventScopes).flat()]),
];

export function appName(): string {
  return `termslack (${userInfo().username})`.slice(0, 35);
}

/** Changes whenever the manifest we'd send changes, so existing apps know to re-sync. */
export function manifestHash(manifest: Manifest): string {
  return Bun.hash(JSON.stringify(manifest)).toString(16);
}

export function buildManifest(
  redirectUri: string,
  name: string = appName(),
): Manifest {
  return {
    display_information: {
      name,
      description: "Personal terminal Slack client created by termslack.",
    },
    oauth_config: {
      redirect_urls: [redirectUri],
      scopes: { user: userScopes },
    },
    settings: {
      event_subscriptions: { user_events: userEvents },
      socket_mode_enabled: true,
      token_rotation_enabled: false,
      org_deploy_enabled: false,
    },
  };
}
