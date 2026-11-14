import type { WebClient } from "@slack/web-api";
import { fetchDndStatus } from "../slack/dnd";
import type { ChangeTracker } from "./changeTracker";
import type { Clock } from "./clock";
import type { DndStatus } from "./events";

/** The longest a timer is set for; longer waits are done in steps (`setTimeout` overflows past ~24 days). */
const maxTimerMs = 2 ** 30;

export type DoNotDisturb = {
  /** Whether Do Not Disturb is on right now: snoozing, or inside a scheduled window. False when Slack's answer isn't known. */
  isOn(): boolean;
  /**
   * Why Do Not Disturb isn't being followed, in words for the status line,
   * until an answer from Slack arrives; undefined when it is being followed.
   */
  note(): string | undefined;
  /** Reads `dnd.info`. Never rejects: a failure or a missing `dnd:read` scope sets `note` and leaves what was known. */
  load(): Promise<void>;
  /** Takes what a `dnd_updated` event says. */
  apply(status: DndStatus): void;
  /** Cancels the timers. */
  stop(): void;
};

/** Whether `status` means Do Not Disturb at `nowSeconds`. */
export function isDndActive(status: DndStatus, nowSeconds: number): boolean {
  if (status.snoozeEndTs !== undefined && nowSeconds < status.snoozeEndTs) {
    return true;
  }

  return (
    status.scheduleEnabled &&
    status.nextStartTs !== undefined &&
    status.nextEndTs !== undefined &&
    status.nextStartTs <= nowSeconds &&
    nowSeconds < status.nextEndTs
  );
}

/** The next time (Unix seconds) after `nowSeconds` that `status` starts or stops meaning Do Not Disturb. */
function nextChange(status: DndStatus, nowSeconds: number): number | undefined {
  const candidates = [
    status.snoozeEndTs,
    ...(status.scheduleEnabled ? [status.nextStartTs, status.nextEndTs] : []),
  ].filter((ts): ts is number => ts !== undefined && ts > nowSeconds);

  return candidates.length > 0 ? Math.min(...candidates) : undefined;
}

/**
 * Keeps the user's Do Not Disturb current: read from `dnd.info`, updated by
 * `dnd_updated`, and moved on by timers when a snooze or a scheduled window
 * starts or ends (Slack sends nothing then). When one has passed, `dnd.info`
 * is read again, since only Slack knows the next window.
 */
export function createDoNotDisturb({
  client,
  scopeProblem,
  clock,
  changes,
  isStopped,
}: {
  client: () => WebClient;
  /** Why `dnd:read` is missing, or undefined when it is there or not known. */
  scopeProblem: () => string | undefined;
  clock: Clock;
  changes: ChangeTracker;
  isStopped: () => boolean;
}): DoNotDisturb {
  let status: DndStatus | undefined;
  let note: string | undefined;
  let cancelTimer: (() => void) | undefined;

  const nowSeconds = () => clock.now() / 1000;

  function schedule(): void {
    cancelTimer?.();
    cancelTimer = undefined;

    if (isStopped() || status === undefined) {
      return;
    }

    const change = nextChange(status, nowSeconds());

    if (change === undefined) {
      return;
    }

    const waitMs = Math.max(0, Math.ceil(change * 1000 - clock.now()));

    cancelTimer = clock.setTimer(onTimer, Math.min(waitMs, maxTimerMs));
  }

  function onTimer(): void {
    cancelTimer = undefined;

    if (isStopped()) {
      return;
    }

    schedule();

    if (status !== undefined && !nextChange(status, nowSeconds())) {
      void load();
    }
  }

  function setNote(next: string | undefined): void {
    if (next !== note) {
      note = next;
      changes.changed();
    }
  }

  function apply(next: DndStatus): void {
    status = next;
    schedule();
    setNote(undefined);
  }

  async function load(): Promise<void> {
    if (scopeProblem()) {
      setNote("no dnd:read permission, so Do Not Disturb is ignored");

      return;
    }

    try {
      const fetched = await fetchDndStatus(client());

      if (!isStopped()) {
        apply(fetched);
      }
    } catch {
      setNote("couldn't read Do Not Disturb, so it is ignored");
    }
  }

  return {
    isOn: () => status !== undefined && isDndActive(status, nowSeconds()),
    note: () => note,
    load,
    apply,
    stop() {
      cancelTimer?.();
      cancelTimer = undefined;
    },
  };
}
