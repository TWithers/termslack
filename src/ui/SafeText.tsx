import { Text as InkText, type TextProps } from "ink";
import { Children, type ReactNode } from "react";
import { terminalSafeText } from "./terminalSafeText";

function safeChildren(children: ReactNode): ReactNode {
  return Children.map(children, (child) =>
    typeof child === "string" ? terminalSafeText(child) : child,
  );
}

/** Ink's `Text` drawing its strings through `terminalSafeText`; nested `Text` does the same for its own. */
export function Text({ children, ...props }: TextProps) {
  return <InkText {...props}>{safeChildren(children)}</InkText>;
}
