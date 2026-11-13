import { describe, expect, test } from "bun:test";
import {
  borderLabelRoom,
  fitBorderLabels,
  keyVariants,
} from "../src/ui/borderLabels";
import { cellWidth } from "../src/ui/terminalSafeText";

/*
 * `width` is the border's inner width: the columns between the corners. A
 * label is drawn as a space, its text and a space, with one dash kept beside
 * the corner, so a lone label has `width - 4` columns of text.
 */

describe("room", () => {
  test("a lone label has the width less a dash and a space on each side", () => {
    expect(borderLabelRoom(20)).toBe(16);
    expect(borderLabelRoom(3)).toBe(0);
  });
});

describe("one label per row", () => {
  test("labels that fit are kept as they are", () => {
    expect(
      fitBorderLabels(30, { topLeft: "Title", bottomLeft: "Esc close" }),
    ).toEqual({ topLeft: "Title", bottomLeft: "Esc close" });
  });

  test("a left title too long is cut with an ellipsis, within its room", () => {
    const fitted = fitBorderLabels(15, { topLeft: "Keyboard shortcuts" });

    expect(fitted.topLeft).toBe("Keyboard s…");
    expect(cellWidth(fitted.topLeft!)).toBe(borderLabelRoom(15));
  });

  test("an ellipsis never follows a space", () => {
    expect(fitBorderLabels(14, { topLeft: "Keyboard shortcuts" }).topLeft).toBe(
      "Keyboard…",
    );
  });

  test("a right-hand label alone that does not fit is dropped, not cut", () => {
    expect(fitBorderLabels(14, { topRight: "12 members" })).toEqual({
      topRight: "12 members",
    });
    expect(fitBorderLabels(12, { topRight: "12 members" })).toEqual({});
  });

  test("a right-hand label alone can shorten before it is dropped", () => {
    expect(fitBorderLabels(12, { topRight: ["12 members", "12"] })).toEqual({
      topRight: "12",
    });
  });

  test("nothing is drawn when there is no room for a character", () => {
    expect(fitBorderLabels(4, { topLeft: "Title" })).toEqual({});
    expect(fitBorderLabels(0, { topLeft: "Title" })).toEqual({});
  });
});

describe("left and right on one row", () => {
  const labels = { topLeft: "#general", topRight: "42 members" };

  test("both fit with a dash between them at least", () => {
    expect(fitBorderLabels(25, labels)).toEqual(labels);
  });

  test("one column short drops the right-hand label first", () => {
    expect(fitBorderLabels(24, labels)).toEqual({ topLeft: "#general" });
  });

  test("the left title is cut only after the right-hand label is gone", () => {
    expect(fitBorderLabels(10, labels)).toEqual({ topLeft: "#gene…" });
  });

  test("the bottom row follows the same rule independently of the top row", () => {
    expect(
      fitBorderLabels(24, {
        topLeft: "#general",
        topRight: "42 members",
        bottomLeft: "● connected",
        bottomRight: "muted hidden",
      }),
    ).toEqual({ topLeft: "#general", bottomLeft: "● connected" });
  });
});

describe("keys shorten before the left label is cut", () => {
  const keys = keyVariants(
    "j/k scroll · PgUp/PgDn page · g/G top/bottom · Esc close",
  );

  test("the variants start with the full text and keep the last key", () => {
    expect(keys[0]).toBe(
      "j/k scroll · PgUp/PgDn page · g/G top/bottom · Esc close",
    );
    expect(keys.at(-1)).toBe("Esc close");
    expect(keys).toEqual([
      "j/k scroll · PgUp/PgDn page · g/G top/bottom · Esc close",
      "j/k scroll · PgUp/PgDn page · Esc close",
      "j/k scroll · Esc close",
      "Esc close",
    ]);
  });

  test("a single key has a single variant", () => {
    expect(keyVariants("Esc close")).toEqual(["Esc close"]);
  });

  test("the longest variant that fits is used", () => {
    expect(fitBorderLabels(60, { bottomLeft: keys }).bottomLeft).toBe(keys[0]);
    expect(fitBorderLabels(44, { bottomLeft: keys }).bottomLeft).toBe(keys[1]);
    expect(fitBorderLabels(30, { bottomLeft: keys }).bottomLeft).toBe(keys[2]);
    expect(fitBorderLabels(14, { bottomLeft: keys }).bottomLeft).toBe(keys[3]);
  });

  test("when even the shortest does not fit it is cut with an ellipsis", () => {
    expect(fitBorderLabels(10, { bottomLeft: keys }).bottomLeft).toBe("Esc c…");
  });

  test("a right-hand label goes before the keys shorten", () => {
    expect(
      fitBorderLabels(60, { bottomLeft: keys, bottomRight: "muted hidden" }),
    ).toEqual({ bottomLeft: keys[0] });
  });
});

describe("wide characters", () => {
  test("widths count cells, so an emoji takes two", () => {
    // "🎉 party" is 8 cells: room 8 needs width 12
    expect(fitBorderLabels(12, { topLeft: "🎉 party" })).toEqual({
      topLeft: "🎉 party",
    });
    expect(fitBorderLabels(11, { topLeft: "🎉 party" }).topLeft).toBe(
      "🎉 par…",
    );
  });

  test("a wide character is never split to fill the last column", () => {
    const fitted = fitBorderLabels(9, { topLeft: "日本語日本語" });

    expect(fitted.topLeft).toBe("日本…");
    expect(cellWidth(fitted.topLeft!)).toBeLessThanOrEqual(borderLabelRoom(9));
  });

  test("a skin tone or joined emoji is measured as it is drawn", () => {
    const fitted = fitBorderLabels(30, { topLeft: "👍🏽 ok" });

    expect(fitted.topLeft).toBe("👍 ok");
  });
});

describe("every width", () => {
  const labels = {
    topLeft: ["#general-channel-name"],
    topRight: ["1,234 members", "1,234"],
    bottomLeft: keyVariants("j/k move · Enter open · Esc close"),
    bottomRight: "muted hidden",
  };

  test("what is returned always fits its border, and the left labels remain once there is room", () => {
    for (let width = 0; width <= 80; width++) {
      const fitted = fitBorderLabels(width, labels);

      for (const row of [
        ["topLeft", "topRight"],
        ["bottomLeft", "bottomRight"],
      ] as const) {
        const [left, right] = row.map(
          (name) => fitted[name as keyof typeof fitted],
        );
        const used =
          (left ? cellWidth(left) + 2 : 0) +
          (right ? cellWidth(right) + 2 : 0) +
          (left && right ? 3 : 2);

        if (left || right) {
          expect(used).toBeLessThanOrEqual(width);
        }
      }

      if (width >= 6) {
        expect(fitted.topLeft).toBeDefined();
        expect(fitted.bottomLeft).toBeDefined();
      }
    }
  });
});
