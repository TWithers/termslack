import { useEffect, useRef, useState } from "react";

/**
 * The status bar's message line: why the last action failed, a hint, or a
 * one-time note. `show(undefined)` clears it. Each of `notes` (for instance
 * that Do Not Disturb is on, or that desktop notifications can't be shown)
 * is shown when it appears or changes, unless a message is already up; the
 * earlier of two notes arriving together wins, so list them by priority.
 */
export function useStatusMessage(notes: (string | undefined)[]): {
  message?: string;
  show(message: string | undefined): void;
} {
  const [message, show] = useState<string>();
  const shown = useRef<(string | undefined)[]>([]);

  useEffect(() => {
    notes.forEach((note, index) => {
      if (note !== undefined && note !== shown.current[index]) {
        show((current) => current ?? note);
      }

      shown.current[index] = note;
    });
  }, notes);

  return { message, show };
}
