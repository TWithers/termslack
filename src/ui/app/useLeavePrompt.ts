import type { WorkspaceSession } from "../../session/workspaceSession";
import {
  type ChannelPrompt,
  type ChannelRef,
  useConfirmPrompt,
} from "./useConfirmPrompt";

/**
 * The "Leave #name? y/n" question `x` on a sidebar channel leads to. Leaving a
 * private channel says that it can't be rejoined without an invite. `report`
 * is the status bar's message line, for why a channel can't be left or why
 * Slack refused; the channel disappears from the sidebar through the session.
 */
export function useLeavePrompt({
  session,
  report,
}: {
  session: WorkspaceSession;
  report(message: string | undefined): void;
}): ChannelPrompt {
  const confirm = useConfirmPrompt<ChannelRef>({
    confirmId: "leave.confirm",
    question: ({ id, label }) =>
      `Leave ${label}?${
        session.conversation(id)?.kind === "group"
          ? " You can't rejoin without an invite."
          : ""
      }`,
    report,
    run({ id }) {
      void session.leaveChannel(id).then((result) => {
        if (!result.ok) {
          report(result.message);
        }
      });
    },
  });

  return {
    prompt: confirm.prompt,
    ask: (channel) =>
      confirm.ask(channel, session.conversationProblem("leave", channel.id)),
    handleKey: confirm.handleKey,
    cancel: confirm.cancel,
  };
}
