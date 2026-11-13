import { expect, test } from "bun:test";
import { setTitle, workspaceTitle } from "../src/ui/app/terminalTitle";

test("the title names the workspace the way the Slack app does", () => {
  expect(workspaceTitle("The HQ")).toBe("The HQ - Slack");
});

test("without a known workspace name the title is just Slack", () => {
  expect(workspaceTitle("Slack")).toBe("Slack");
});

test("control characters in a name can't end the title sequence early", () => {
  expect(setTitle("Evil\x07\x1b]0;pwned\nCo")).toBe(
    "\x1b]0;Evil]0;pwnedCo\x1b\\",
  );
});
