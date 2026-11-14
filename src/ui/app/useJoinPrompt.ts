import { type RefObject } from "react";
import type { WorkspaceSession } from "../../session/workspaceSession";
import {
  type ChannelPrompt,
  type ChannelRef,
  useConfirmPrompt,
} from "./useConfirmPrompt";

/**
 * The "Join #name? y/n" question the quick switcher leads to for a public
 * channel the user isn't in. `join` is called with the channel once it is
 * joined, unless the user opened another conversation meanwhile (`opens`
 * counts those), and `report` is the status line's message line, for why Slack
 * refused.
 */
export function useJoinPrompt({
  session,
  opens,
  join,
  report,
}: {
  session: WorkspaceSession;
  opens: RefObject<number>;
  join(conversationId: string): void;
  report(message: string | undefined): void;
}): ChannelPrompt {
  const confirm = useConfirmPrompt<ChannelRef>({
    confirmId: "join.confirm",
    question: ({ label }) => `Join ${label}?`,
    report,
    run({ id }) {
      const mine = opens.current;

      void session.joinChannel(id).then((result) => {
        if (!result.ok) {
          report(result.message);
          return;
        }

        if (opens.current === mine) {
          join(result.conversationId);
        }
      });
    },
  });

  return {
    prompt: confirm.prompt,
    ask: (channel) =>
      confirm.ask(channel, session.conversationProblem("join", channel.id)),
    handleKey: confirm.handleKey,
    cancel: confirm.cancel,
  };
}
