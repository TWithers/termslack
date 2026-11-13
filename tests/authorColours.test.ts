import { afterEach, describe, expect, test } from "bun:test";
import { conversationRows } from "../src/ui/app/paneRows";
import {
  authorColour,
  fallbackColour,
  legibleColour,
} from "../src/ui/authorColour";
import {
  contrastRatio,
  minimumContrast,
  relativeLuminance,
} from "../src/ui/colour";
import { theme } from "../src/ui/theme";
import { type AppHarness, keys, startAppHarness } from "./support/appHarness";
import { waitFor } from "./support/fakeSlack";
import { loadFixture, loadPayload } from "./support/fixtures";
import {
  type SessionHarness,
  startSessionHarness,
} from "./support/sessionHarness";

describe("contrastRatio", () => {
  test("is 1 for equal colours and 21 for black on white, whichever way round", () => {
    expect(contrastRatio("#336699", "#336699")).toBeCloseTo(1);
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21);
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21);
  });
});

describe("legibleColour", () => {
  const dark = theme.paneBackground;

  test("leaves a colour that reads clearly on the background alone", () => {
    expect(legibleColour("#9f69e7", dark)).toBe("#9f69e7");
  });

  test("lightens a colour equal to a dark background until it reads", () => {
    const result = legibleColour(dark, dark);

    expect(contrastRatio(result, dark)).toBeGreaterThanOrEqual(minimumContrast);
    expect(relativeLuminance(result)).toBeGreaterThan(relativeLuminance(dark));
  });

  test("lightens black on a dark background", () => {
    expect(
      contrastRatio(legibleColour("#000000", dark), dark),
    ).toBeGreaterThanOrEqual(minimumContrast);
  });

  test("keeps the hue of a dark colour while lightening it", () => {
    const result = legibleColour("#200010", dark);
    const [red, green, blue] = [1, 3, 5].map((at) =>
      Number.parseInt(result.slice(at, at + 2), 16),
    );

    expect(contrastRatio(result, dark)).toBeGreaterThanOrEqual(minimumContrast);
    expect(red).toBeGreaterThan(green!);
    expect(blue).toBeGreaterThan(green!);
  });

  test("darkens a colour too close to a light background, so a light theme works with the same rule", () => {
    const light = "#ffffff";

    expect(legibleColour("#f0f0a0", light)).not.toBe("#f0f0a0");
    expect(
      contrastRatio(legibleColour("#f0f0a0", light), light),
    ).toBeGreaterThanOrEqual(minimumContrast);
    expect(
      contrastRatio(legibleColour("#ffffff", light), light),
    ).toBeGreaterThanOrEqual(minimumContrast);
    expect(relativeLuminance(legibleColour("#ffffff", light))).toBeLessThan(
      0.5,
    );
    expect(legibleColour("#202060", light)).toBe("#202060");
  });

  test("adjusts against the pane background by default", () => {
    expect(legibleColour(theme.paneBackground)).toBe(
      legibleColour(theme.paneBackground, theme.paneBackground),
    );
  });
});

describe("fallbackColour", () => {
  test("is the same colour for the same key", () => {
    expect(fallbackColour("U123")).toBe(fallbackColour("U123"));
  });

  test("always comes from the theme's fallback names, all of which read on the pane", () => {
    for (let id = 0; id < 100; id++) {
      expect(theme.fallbackNameColours).toContain(fallbackColour(`U${id}`));
    }

    for (const colour of theme.fallbackNameColours) {
      expect(
        contrastRatio(colour, theme.paneBackground),
      ).toBeGreaterThanOrEqual(minimumContrast);
    }
  });

  test("spreads different keys over the palette", () => {
    const used = new Set(
      Array.from({ length: 100 }, (_, id) => fallbackColour(`U${id}`)),
    );

    expect(used.size).toBeGreaterThan(theme.fallbackNameColours.length / 2);
  });
});

describe("authorColour", () => {
  const lookup = {
    user: (id: string) =>
      id === "U1" ? { id, color: "#9f69e7" } : id === "U2" ? { id } : undefined,
    bot: (id: string) => (id === "B1" ? { id, name: "Deploy" } : undefined),
  };

  test("uses the person's own colour", () => {
    expect(authorColour({ userId: "U1" }, lookup)).toBe("#9f69e7");
  });

  test("falls back by user ID for a person without a colour or one not known", () => {
    expect(authorColour({ userId: "U2" }, lookup)).toBe(fallbackColour("U2"));
    expect(authorColour({ userId: "U9" }, lookup)).toBe(fallbackColour("U9"));
  });

  test("a Slack colour too close to the background is made legible", () => {
    const hidden = (id: string) => ({ id, color: theme.paneBackground });

    expect(authorColour({ userId: "U3" }, { user: hidden })).toBe(
      legibleColour(theme.paneBackground),
    );
    expect(authorColour({ userId: "U3" }, { user: hidden })).not.toBe(
      theme.paneBackground,
    );
  });

  test("is adjusted against the background it is drawn on", () => {
    expect(authorColour({ userId: "U1" }, lookup, theme.popupBackground)).toBe(
      legibleColour("#9f69e7", theme.popupBackground),
    );
  });

  test("someone with nothing to go by gets the theme's default name colour", () => {
    expect(authorColour({}, lookup)).toBe(theme.defaultNameColour);
  });

  test("falls back by bot ID, else bot name", () => {
    expect(authorColour({ botId: "B1" }, lookup)).toBe(fallbackColour("B1"));
    expect(authorColour({ botName: "Deploy" }, lookup)).toBe(
      fallbackColour("Deploy"),
    );
  });
});

describe("reading and keeping a user's colour", () => {
  let harness: SessionHarness;

  afterEach(() => harness.stop());

  async function startWithUsers() {
    const pages = await loadFixture("users-list");

    harness = await startSessionHarness({
      prepare: (slack) => slack.respondPaged("users.list", pages),
    });
    await waitFor(() => harness.session.users().length === 4);
  }

  test("users.list members carry their colour as #rrggbb, when they have one", async () => {
    await startWithUsers();

    expect(harness.session.user("U123ABC456")?.color).toBe("#9f69e7");
    expect(harness.session.user("U222222222")?.color).toBeUndefined();
  });

  test("users.info reads the colour, ignoring one that is not hex", async () => {
    const [info] = await loadFixture("users-info");

    harness = await startSessionHarness({
      prepare: (slack) =>
        slack.respond("users.info", (call) => ({
          ...info,
          user: {
            ...info?.user,
            id: call.params.user,
            color: call.params.user === "U1" ? "9F69E7" : "purple",
          },
        })),
    });
    for (const user of ["U1", "U2"]) {
      await harness.sendEvents({
        event: {
          type: "message",
          channel: "C012AB3CD",
          user,
          text: "Hello",
          ts: `1.${user}`,
        },
      });
    }

    await waitFor(
      () => harness.session.user("U1") && harness.session.user("U2"),
    );

    expect(harness.session.user("U1")?.color).toBe("#9f69e7");
    expect(harness.session.user("U2")?.color).toBeUndefined();
  });

  test("a profile event that omits the colour keeps it", async () => {
    await startWithUsers();
    await harness.sendEvents(await loadPayload("user-profile-changed"));

    expect(harness.session.user("U123ABC456")).toMatchObject({
      displayName: "egon the great",
      color: "#9f69e7",
    });
  });

  test("a profile event that carries a colour changes it", async () => {
    await startWithUsers();

    const payload = await loadPayload("user-profile-changed");

    payload.event.user.color = "e7392d";
    await harness.sendEvents(payload);

    expect(harness.session.user("U123ABC456")?.color).toBe("#e7392d");
  });
});

describe("author headers in the pane", () => {
  let app: AppHarness;

  afterEach(() => app.stop());

  const general = "C012AB3CD";
  const egon = "U123ABC456";
  const venkman = "U222222222";
  const stantz = "U333333333";

  async function start(messages: Record<string, unknown>[]) {
    const pages = await loadFixture("users-list");

    app = await startAppHarness({
      columns: 100,
      rows: 30,
      prepare: (slack) => {
        slack.respondPaged("users.list", pages);
        slack.respondPaged("conversations.history", [
          { ok: true, messages: [...messages].reverse(), has_more: false },
        ]);
      },
    });
    await app.waitForScreen("#general", 5000);
    await waitFor(() => app.session.users().length === 4);
    await app.press(keys.enter);
    await waitFor(
      () =>
        conversationRows(app.session, general, 100).rows.some(
          (row) => row.kind === "authorHeader",
        ),
      5000,
    );
  }

  const headerRuns = () =>
    conversationRows(app.session, general, 100)
      .rows.filter((row) => row.kind === "authorHeader")
      .map((row) => row.runs[0]!);

  const say = (extra: Record<string, unknown>, ts: string) => ({
    type: "message",
    text: "hi",
    ts,
    ...extra,
  });

  test("a person's name is drawn in their Slack colour", async () => {
    await start([say({ user: egon }, "1762286400.000100")]);

    expect(headerRuns()[0]).toMatchObject({
      text: "egon",
      color: "#9f69e7",
      bold: true,
    });
  });

  test("a very dark Slack colour is lightened", async () => {
    await start([say({ user: stantz }, "1762286400.000100")]);

    expect(headerRuns()[0]?.color).toBe(legibleColour("#0a0a0a"));
    expect(headerRuns()[0]?.color).not.toBe("#0a0a0a");
    expect(
      contrastRatio(headerRuns()[0]!.color!, theme.paneBackground),
    ).toBeGreaterThanOrEqual(minimumContrast);
  });

  test("people without a colour, bots and unknown authors get a stable fallback", async () => {
    await start([
      say({ user: venkman }, "1762286400.000100"),
      say(
        { subtype: "bot_message", bot_id: "B0DEPLOY1", username: "Deploy" },
        "1762286900.000100",
      ),
      say({ user: "U0GHOST001" }, "1762287400.000100"),
    ]);

    expect(headerRuns().map((run) => run.color)).toEqual([
      fallbackColour(venkman),
      fallbackColour("B0DEPLOY1"),
      fallbackColour("U0GHOST001"),
    ]);
  });
});
