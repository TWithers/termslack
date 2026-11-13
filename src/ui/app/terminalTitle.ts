/** Pushes the terminal's current title onto its title stack, so `restoreTitle` can bring it back. Terminals without one ignore it. */
export const saveTitle = "\x1b[22;0t";
export const restoreTitle = "\x1b[23;0t";

/** The window and tab title for a workspace, as the Slack app names its windows: "The HQ - Slack". */
export function workspaceTitle(workspaceName: string): string {
  return workspaceName === "Slack" ? "Slack" : `${workspaceName} - Slack`;
}

/** Sets the window and tab title (OSC 0). Control characters are dropped so a name can't end the sequence early. */
export function setTitle(title: string): string {
  return `\x1b]0;${title.replace(/[\x00-\x1f\x7f]/g, "")}\x1b\\`;
}
