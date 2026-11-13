import type { UnrecognizedEvent } from "../../session/events";

export function unrecognized(
  envelopeType: string,
  body: Record<string, any>,
  issues: string[] = [],
): UnrecognizedEvent {
  const event = isObject(body.event) ? body.event : undefined;

  return {
    kind: "unrecognized",
    envelopeType,
    eventType: event ? String(event.type) : undefined,
    event,
    timestamp: event ? timestampOf(event) : undefined,
    raw: body,
    issues,
  };
}

export function isObject(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function timestampOf(event: Record<string, any>): string | undefined {
  const timestamp = event.event_ts ?? event.ts;

  return typeof timestamp === "string" ? timestamp : undefined;
}

export function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** Reads a string the event is expected to have, recording an issue if it doesn't. */
export function required(
  source: Record<string, any>,
  field: string,
  issues: string[],
  label = field,
): string {
  const value = source[field];

  if (typeof value === "string") {
    return value;
  }

  issues.push(`missing ${label}`);

  return "";
}

/** A string that may legitimately be empty ("cleared"); undefined when absent. */
export function presentString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
