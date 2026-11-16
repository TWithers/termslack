import { describe, expect, test } from "bun:test";
import { hyperlink, linkableUrl } from "../src/ui/hyperlink";

describe("which addresses are linked", () => {
  test("web and mail addresses are", () => {
    expect(linkableUrl("https://x.test/a?b=c#d")).toBe(
      "https://x.test/a?b=c#d",
    );
    expect(linkableUrl("http://x.test")).toBe("http://x.test");
    expect(linkableUrl("HTTPS://X.TEST")).toBe("HTTPS://X.TEST");
    expect(linkableUrl("mailto:egon@x.test")).toBe("mailto:egon@x.test");
  });

  test("other schemes are not, so a click never runs or opens something local", () => {
    expect(linkableUrl("javascript:alert(1)")).toBeUndefined();
    expect(linkableUrl("file:///etc/passwd")).toBeUndefined();
    expect(linkableUrl("ssh://x.test")).toBeUndefined();
    expect(linkableUrl("x.test/a")).toBeUndefined();
  });

  test("an address with a control character is not, so it cannot end the escape early", () => {
    expect(linkableUrl("https://x.test/\u001b\\\u001b[2J")).toBeUndefined();
    expect(linkableUrl("https://x.test/\u0007")).toBeUndefined();
    expect(linkableUrl("https://x.test/\u009c")).toBeUndefined();
    expect(linkableUrl("https://x.test/a b")).toBeUndefined();
  });
});

describe("the escape", () => {
  test("text is wrapped in OSC 8 opening and closing the link", () => {
    expect(hyperlink("docs", "https://x.test/a")).toBe(
      "\u001b]8;;https://x.test/a\u001b\\docs\u001b]8;;\u001b\\",
    );
  });

  test("the text is unchanged once escapes are stripped", () => {
    expect(Bun.stripANSI(hyperlink("docs", "https://x.test/a"))).toBe("docs");
    expect(Bun.stringWidth(hyperlink("docs", "https://x.test/a"))).toBe(4);
  });

  test("an address that cannot be linked leaves the text plain", () => {
    expect(hyperlink("click", "javascript:alert(1)")).toBe("click");
  });
});
