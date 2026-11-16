import { afterEach, expect, test } from "bun:test";
import { type AppHarness, keys, startAppHarness } from "./support/appHarness";

let app: AppHarness;

afterEach(() => app.stop());

const other = "U222222222";

async function showMessage(text: string) {
  app = await startAppHarness({
    columns: 120,
    rows: 30,
    prepare: (slack) => {
      slack.respond("conversations.history", () => ({
        ok: true,
        messages: [
          { type: "message", user: other, text, ts: "1700000300.000100" },
        ],
        has_more: false,
      }));
    },
  });
  await app.waitForScreen("#general", 5000);
  await app.press(keys.enter);
  await app.waitForScreen("end");
}

const linkTo = (url: string) => `\u001b]8;;${url}`;
const drawn = () => app.coloredScreen().join("\n");

const terminator = "(?:\u0007|\u001b\\\\)";
const linkPattern = new RegExp(
  `\u001b\\]8;;([^\u0007\u001b]+)${terminator}(.*?)\u001b\\]8;;${terminator}`,
  "g",
);

/** The text drawn as a hyperlink to `url`, each link's text on its own. */
function linkedText(url: string): string[] {
  return [...drawn().matchAll(linkPattern)]
    .filter((match) => match[1] === url)
    .map((match) => Bun.stripANSI(match[2]!));
}

test("a link's label is a terminal hyperlink to its address", async () => {
  await showMessage("see <https://x.test/a|docs> end");

  expect(drawn()).toContain(linkTo("https://x.test/a"));
  expect(linkedText("https://x.test/a")).toContain("docs");
});

test("the address after a label links to it too", async () => {
  await showMessage("see <https://x.test/a|docs> end");

  expect(linkedText("https://x.test/a").join("")).toContain(
    "(https://x.test/a)",
  );
});

test("a bare address is a hyperlink to itself", async () => {
  await showMessage("see <https://x.test/b> end");

  expect(linkedText("https://x.test/b")).toContain("https://x.test/b");
});

test("the link ends after it, so the words that follow are not linked", async () => {
  await showMessage("see <https://x.test/a|docs> end");

  const linked = [...drawn().matchAll(linkPattern)].map((match) =>
    Bun.stripANSI(match[2]!),
  );

  expect(linked).toEqual(["docs", "(https://x.test/a)"]);
});

test("hyperlinks leave what is drawn unchanged", async () => {
  await showMessage("see <https://x.test/a|docs> end");

  expect(app.screen()).toContain("see docs (https://x.test/a) end");
});

test("a link to something other than a web or mail address is not a hyperlink", async () => {
  await showMessage("see <javascript:alert(1)|click> end");

  expect(app.screen()).toContain("click");
  expect(drawn()).not.toContain("\u001b]8;;javascript");
});
