import type { DndEvent, DndStatus } from "../../session/events";
import { isObject, optionalString, timestampOf } from "./shared";

function seconds(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

/**
 * Turns Slack's Do Not Disturb fields (the body of `dnd.info`, or an event's
 * `dnd_status`) into termslack's own type. Returns undefined when `dnd_enabled`
 * isn't there, since then nothing can be said.
 */
export function convertDndStatus(raw: unknown): DndStatus | undefined {
  if (!isObject(raw) || typeof raw.dnd_enabled !== "boolean") {
    return undefined;
  }

  const snoozeEndTs = seconds(raw.snooze_endtime);

  return {
    scheduleEnabled: raw.dnd_enabled,
    nextStartTs: seconds(raw.next_dnd_start_ts),
    nextEndTs: seconds(raw.next_dnd_end_ts),
    snoozeEndTs: raw.snooze_enabled === true ? snoozeEndTs : undefined,
  };
}

/** Reads `dnd_updated` and `dnd_updated_user`. */
export function convertDndEvent(
  body: Record<string, any>,
  event: Record<string, any>,
): DndEvent {
  const issues: string[] = [];
  const status = convertDndStatus(event.dnd_status);
  const userId = optionalString(event.user);

  if (!status) {
    issues.push("missing dnd_status.dnd_enabled");
  }

  if (!userId) {
    issues.push("missing user");
  }

  return {
    kind: "dnd",
    eventType: String(event.type),
    userId: userId ?? "",
    status: status ?? { scheduleEnabled: false },
    timestamp: timestampOf(event),
    raw: body,
    issues,
  };
}
