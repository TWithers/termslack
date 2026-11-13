/** What the app does that a Slack permission can be missing for. */
export type ScopedFeature =
  | "write"
  | "react"
  | "dm"
  | "join"
  | "leave"
  | "leavePrivate"
  | "search"
  | "dnd";

const scopeFor: Record<ScopedFeature, string> = {
  write: "chat:write",
  react: "reactions:write",
  dm: "im:write",
  join: "channels:write",
  leave: "channels:write",
  leavePrivate: "groups:write",
  search: "search:read",
  dnd: "dnd:read",
};

const doing: Record<ScopedFeature, string> = {
  write: "Writing messages is off",
  react: "Reacting is off",
  dm: "Starting direct messages is off",
  join: "Joining channels is off",
  leave: "Leaving channels is off",
  leavePrivate: "Leaving private channels is off",
  search: "Searching messages is off",
  dnd: "Reading Do Not Disturb is off",
};

/** What a failed call says when Slack answers `missing_scope`: what the feature was doing and the permission it needs. */
export function missingScopeText(
  feature: ScopedFeature,
  action: string,
): string {
  return `To ${action} termslack needs the ${scopeFor[feature]} permission. Run termslack's setup again to grant it.`;
}

export type Scopes = {
  /** Records what the token was granted; undefined when that isn't known. */
  grant(scopes: string[] | undefined): void;
  /**
   * Why the feature is off, in words for the UI, or undefined when it is
   * available. A feature is off only when the granted scopes are known and
   * lack the one it needs.
   */
  problem(feature: ScopedFeature): string | undefined;
};

/** Tracks the scopes the token was granted, so features that need a missing one are refused up front. */
export function createScopes(): Scopes {
  let granted: string[] | undefined;

  return {
    grant(scopes) {
      granted = scopes;
    },

    problem(feature) {
      const scope = scopeFor[feature];

      return granted === undefined || granted.includes(scope)
        ? undefined
        : `${doing[feature]}: the ${scope} permission is missing. Run termslack's setup again to grant it.`;
    },
  };
}
