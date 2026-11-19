/**
 * The OSC 52 sequence that asks the terminal to put `text` on the system
 * clipboard (`c`). The terminal does the copying, so it works over SSH too;
 * a terminal that doesn't support it ignores the sequence.
 */
export function clipboardSequence(text: string): string {
  const encoded = Buffer.from(text, "utf8").toString("base64");

  return `\u001b]52;c;${encoded}\u001b\\`;
}
