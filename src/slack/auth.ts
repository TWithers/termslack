import type { WebClient } from "@slack/web-api";
import { convertCurrentUserId, convertGrantedScopes } from "./convert";

export type Identity = {
  /** Who the token belongs to; undefined when Slack didn't say. */
  userId?: string;
  /** What the token may do; undefined when Slack didn't say. */
  scopes?: string[];
};

/** Who the token belongs to and what it may do. Rejects with Slack's error. */
export async function fetchIdentity(client: WebClient): Promise<Identity> {
  const response = await client.auth.test();

  return {
    userId: convertCurrentUserId(response),
    scopes: convertGrantedScopes(response),
  };
}
