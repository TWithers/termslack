import type { WebClient } from "@slack/web-api";
import { fetchPresence } from "../slack/presence";
import type { ChangeTracker } from "./changeTracker";
import type { Clock } from "./clock";
import type { Presence } from "./events";

export type PresenceOptions = {
  /** The least time between two checks of one person, in ms. Defaults to 5 minutes. */
  refreshIntervalMs?: number;
  /** The most calls made in any minute. Defaults to 20, well under the method's limit. */
  callsPerMinute?: number;
  /** How long someone off screen keeps the presence they had before it is forgotten, in ms. Defaults to 10 minutes. */
  forgetAfterMs?: number;
};

export type PresenceService = {
  /**
   * Says who is on screen, in screen order (the open DM and the DMs in the
   * sidebar's window). Those not checked lately are checked soon; those who
   * left the screen for `forgetAfterMs` are forgotten.
   */
  setVisible(userIds: string[]): void;
  /** What was last learned about a person, if they were checked and are not forgotten. */
  get(userId: string): Presence | undefined;
  /** Looks again at who may be checked, after something that decides it (who the user is, who is a bot) became known. */
  reconsider(): void;
  /** Cancels the timer; nothing is checked after this. */
  stop(): void;
};

const defaultRefreshIntervalMs = 5 * 60_000;
const defaultCallsPerMinute = 20;
const defaultForgetAfterMs = 10 * 60_000;
const minuteMs = 60_000;
/** How many times slower the calls get at most while Slack keeps refusing them. */
const maxBackoff = 16;

type Entry = {
  presence?: Presence;
  checkedAt?: number;
  attemptedAt?: number;
  offScreenSince?: number;
};

/**
 * Polls `users.getPresence` for the people on screen (Socket Mode delivers no
 * presence changes to a user token, so polling is the only way). One call at
 * a time, spread evenly: a minute divided by `callsPerMinute` apart, and never
 * more than that many in any minute. The longest-unchecked person goes first;
 * someone is checked again once `refreshIntervalMs` has passed. A temporary
 * failure (a 429 the shared client could not wait out, say) leaves the person
 * to be tried again and doubles the spacing until a call succeeds; an error
 * about the person leaves them unknown until the next refresh; an error that
 * no call can get past (a missing scope) ends the polling. None is reported.
 */
export function createPresence({
  client,
  clock,
  changes,
  isStopped,
  isCheckable,
  options: {
    refreshIntervalMs = defaultRefreshIntervalMs,
    callsPerMinute = defaultCallsPerMinute,
    forgetAfterMs = defaultForgetAfterMs,
  } = {},
}: {
  client: () => WebClient;
  clock: Clock;
  changes: ChangeTracker;
  isStopped: () => boolean;
  /** Whether a person may be checked: not the user, a bot, or a deleted account, and only once that is known. */
  isCheckable: (userId: string) => boolean;
  options?: PresenceOptions;
}): PresenceService {
  const entries = new Map<string, Entry>();
  const callTimes: number[] = [];
  const gapMs = Math.ceil(minuteMs / Math.max(1, callsPerMinute));
  let visible: string[] = [];
  let inFlight = false;
  let unavailable = false;
  let backoff = 1;
  let cancelTimer: (() => void) | undefined;

  /** The people to check, the one waiting longest first. */
  function due(): string[] {
    const now = clock.now();

    return visible
      .filter((id) => {
        const checkedAt = entries.get(id)?.checkedAt;

        return (
          isCheckable(id) &&
          (checkedAt === undefined || now - checkedAt >= refreshIntervalMs)
        );
      })
      .sort(
        (a, b) =>
          (entries.get(a)?.attemptedAt ?? -Infinity) -
          (entries.get(b)?.attemptedAt ?? -Infinity),
      );
  }

  /** The earliest time the next call may be made. */
  function nextCallAt(): number {
    const now = clock.now();

    while (callTimes.length > 0 && callTimes[0]! <= now - minuteMs) {
      callTimes.shift();
    }

    const lastCall = callTimes.at(-1);
    const afterGap = lastCall === undefined ? 0 : lastCall + gapMs * backoff;
    const afterCap =
      callTimes.length >= callsPerMinute
        ? callTimes[callTimes.length - callsPerMinute]! + minuteMs
        : 0;

    return Math.max(afterGap, afterCap);
  }

  function forgetExpired(): void {
    const now = clock.now();
    let forgot = false;

    for (const [id, entry] of entries) {
      if (
        entry.offScreenSince !== undefined &&
        now - entry.offScreenSince >= forgetAfterMs
      ) {
        entries.delete(id);
        forgot ||= entry.presence !== undefined;
      }
    }

    if (forgot) {
      changes.changed();
    }
  }

  /** Sets the timer for the next thing to do: a call, a refresh coming due, or something to forget. */
  function schedule(): void {
    cancelTimer?.();
    cancelTimer = undefined;

    if (isStopped() || unavailable || inFlight) {
      return;
    }

    forgetExpired();

    const now = clock.now();
    const waits: number[] = [];

    if (due().length > 0) {
      waits.push(nextCallAt() - now);
    }

    for (const id of visible) {
      const checkedAt = entries.get(id)?.checkedAt;

      if (checkedAt !== undefined && isCheckable(id)) {
        waits.push(checkedAt + refreshIntervalMs - now);
      }
    }

    for (const { offScreenSince } of entries.values()) {
      if (offScreenSince !== undefined) {
        waits.push(offScreenSince + forgetAfterMs - now);
      }
    }

    if (waits.length > 0) {
      cancelTimer = clock.setTimer(onTimer, Math.max(0, Math.min(...waits)));
    }
  }

  function onTimer(): void {
    cancelTimer = undefined;

    if (isStopped()) {
      return;
    }

    forgetExpired();

    const [next] = due();

    if (next !== undefined && clock.now() >= nextCallAt()) {
      void check(next);

      return;
    }

    schedule();
  }

  async function check(id: string): Promise<void> {
    const entry = entries.get(id);

    if (!entry) {
      return;
    }

    inFlight = true;
    callTimes.push(clock.now());
    entry.attemptedAt = clock.now();

    const result = await fetchPresence(client(), id);

    inFlight = false;

    if (isStopped()) {
      return;
    }

    const current = entries.get(id);

    if (result.status === "unavailable") {
      unavailable = true;
      entries.clear();
      changes.changed();

      return;
    }

    if (result.status === "failed") {
      backoff = Math.min(backoff * 2, maxBackoff);
    } else {
      backoff = 1;
    }

    if (current && result.status !== "failed") {
      const presence = result.status === "found" ? result.presence : undefined;

      current.checkedAt = clock.now();

      if (current.presence !== presence) {
        current.presence = presence;
        changes.changed();
      }
    }

    schedule();
  }

  return {
    setVisible(userIds) {
      const now = clock.now();
      const shown = new Set(userIds);

      visible = [...shown];

      for (const id of shown) {
        const entry = entries.get(id) ?? {};

        entry.offScreenSince = undefined;
        entries.set(id, entry);
      }

      for (const [id, entry] of entries) {
        if (shown.has(id)) {
          continue;
        }

        if (entry.presence === undefined) {
          entries.delete(id);
        } else {
          entry.offScreenSince ??= now;
        }
      }

      schedule();
    },
    get: (userId) => entries.get(userId)?.presence,
    reconsider: schedule,
    stop() {
      cancelTimer?.();
      cancelTimer = undefined;
    },
  };
}
