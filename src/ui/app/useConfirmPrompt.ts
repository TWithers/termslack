import type { Key } from "ink";
import { useState } from "react";
import { pressed, type ShortcutId } from "./shortcuts";

export type ConfirmPrompt<Subject> = {
  /** What the status line asks while a key is awaited; undefined when nothing is. */
  prompt?: string;
  /**
   * Asks about `subject`, unless `problem` says it can't be done (then the
   * status line shows that instead, and nothing is asked).
   */
  ask(subject: Subject, problem: string | undefined): void;
  /** Answers a pending question (`y` runs the action, anything else cancels); returns whether a question was pending, so the key is used up. */
  handleKey(input: string, key: Key): boolean;
  /** Cancels a pending question, as `n` does. */
  cancel(): void;
};

/**
 * A y/n question in the status line: "Leave #general? y/n". The next key
 * answers it, the confirm shortcut `confirmId` (`y`) runs `run` with the
 * subject asked about and any other key cancels, and nothing else sees that
 * key. `report` is the status line's message line, for why asking isn't
 * possible.
 */
export function useConfirmPrompt<Subject>({
  confirmId,
  question,
  run,
  report,
}: {
  confirmId: ShortcutId;
  /** The question for a subject, without the `y/n` that is added. */
  question(subject: Subject): string;
  run(subject: Subject): void;
  report(message: string | undefined): void;
}): ConfirmPrompt<Subject> {
  const [asking, setAsking] = useState<{ subject: Subject }>();

  return {
    prompt: asking ? `${question(asking.subject)} y/n` : undefined,

    ask(subject, problem) {
      report(problem);

      if (problem === undefined) {
        setAsking({ subject });
      }
    },

    handleKey(input, key) {
      if (!asking) {
        return false;
      }

      setAsking(undefined);

      if (pressed(confirmId, input, key)) {
        run(asking.subject);
      }

      return true;
    },

    cancel() {
      setAsking(undefined);
    },
  };
}

/** A channel the join and leave questions are about. */
export type ChannelRef = { id: string; label: string };

/** The question about a channel: `ask` works out for itself whether the channel can be asked about. */
export type ChannelPrompt = Omit<ConfirmPrompt<ChannelRef>, "ask"> & {
  ask(channel: ChannelRef): void;
};
