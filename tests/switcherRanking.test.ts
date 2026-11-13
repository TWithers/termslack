import { describe, expect, test } from "bun:test";
import {
  bestMatch,
  normalizeFilter,
  rankCandidates,
  type SwitcherCandidate,
} from "../src/ui/app/switcherRanking";

const read = { isUnread: false, mentions: 0 };

const candidate = (
  name: string,
  markers = read,
  prefix = "#",
): SwitcherCandidate => ({
  id: `id:${name}`,
  label: `${prefix}${name}`,
  names: [name],
  markers,
});

const ranked = (
  candidates: SwitcherCandidate[],
  filter: string,
  recent: string[] = [],
) => rankCandidates(candidates, filter, recent).map(({ label }) => label);

describe("matching", () => {
  test("the letters must appear in order, ignoring case", () => {
    expect(bestMatch(["Team-Deploys"], "tdp")).toBeDefined();
    expect(bestMatch(["TEAM-DEPLOYS"], "dep")).toBeDefined();
    expect(bestMatch(["team-deploys"], "pdt")).toBeUndefined();
    expect(bestMatch(["general"], "generalx")).toBeUndefined();
  });

  test("a candidate matches on any of its names, by the best one", () => {
    expect(bestMatch(["Sarah Connor", "sconnor", "sarah"], "sarah")).toBe(0);
    expect(bestMatch(["Sarah Connor", "sconnor"], "conn")).toBe(2);
  });

  test("a leading # or @ and surrounding spaces are not part of the filter", () => {
    expect(normalizeFilter(" #Gen ")).toBe("gen");
    expect(normalizeFilter("@sar")).toBe("sar");
  });
});

describe("ranking", () => {
  const all = [
    candidate("my-general-thoughts"),
    candidate("generally"),
    candidate("team-general"),
    candidate("general"),
    candidate("gxexnxexral"),
    candidate("unrelated"),
  ];

  test("exact matches come first, then prefixes, then word starts, then other in-order matches", () => {
    expect(ranked(all, "general")).toEqual([
      "#general",
      "#generally",
      "#my-general-thoughts",
      "#team-general",
      "#gxexnxexral",
    ]);
    expect(ranked(all, "gen")).toEqual([
      "#general",
      "#generally",
      "#my-general-thoughts",
      "#team-general",
      "#gxexnxexral",
    ]);
  });

  test("dep finds team-deploys by the start of a word", () => {
    expect(
      ranked(
        [
          candidate("independent"),
          candidate("team-deploys"),
          candidate("zdzezp"),
        ],
        "dep",
      ),
    ).toEqual(["#team-deploys", "#independent", "#zdzezp"]);
  });

  test("ties go to unread conversations, then the most recently opened, then the name", () => {
    const candidates = [
      candidate("alpha-app"),
      candidate("beta-app"),
      candidate("gamma-app", { isUnread: true, mentions: 0 }),
      candidate("delta-app"),
    ];

    expect(ranked(candidates, "app", ["id:delta-app", "id:beta-app"])).toEqual([
      "#gamma-app",
      "#delta-app",
      "#beta-app",
      "#alpha-app",
    ]);
  });

  test("a mention counts as unread", () => {
    const candidates = [
      candidate("aaa"),
      candidate("bbb", { isUnread: true, mentions: 2 }),
    ];

    expect(ranked(candidates, "")[0]).toBe("#bbb");
  });

  test("match quality outranks unread and recency", () => {
    const candidates = [
      candidate("xdevx", { isUnread: true, mentions: 0 }),
      candidate("dev"),
    ];

    expect(ranked(candidates, "dev", ["id:xdevx"])).toEqual(["#dev", "#xdevx"]);
  });

  test("DMs match on the name without the @", () => {
    const sarah = candidate("Sarah Connor", read, "@");

    expect(ranked([sarah, candidate("general")], "@sar")).toEqual([
      "@Sarah Connor",
    ]);
  });

  test("with no filter the recently opened come first, then unread, then the rest by name", () => {
    const candidates = [
      candidate("zeta"),
      candidate("beta"),
      candidate("alpha"),
      candidate("quiet", { isUnread: true, mentions: 0 }),
      candidate("kappa"),
    ];

    expect(ranked(candidates, "", ["id:kappa", "id:zeta"])).toEqual([
      "#kappa",
      "#zeta",
      "#quiet",
      "#alpha",
      "#beta",
    ]);
  });
});

describe("channels the user isn't in", () => {
  const stranger = (name: string): SwitcherCandidate => ({
    ...candidate(name),
    notMember: true,
  });

  test("rank below an equally good match among those the user is in, even an unread one, but not below a worse match", () => {
    const candidates = [
      stranger("deploy"),
      candidate("deploy-log", { isUnread: true, mentions: 0 }),
      candidate("deploy"),
      candidate("my-deploy"),
    ];

    expect(ranked(candidates, "deploy")).toEqual([
      "#deploy",
      "#deploy",
      "#deploy-log",
      "#my-deploy",
    ]);
    expect(
      rankCandidates(candidates, "deploy", []).map(
        ({ notMember }) => notMember === true,
      ),
    ).toEqual([false, true, false, false]);
  });

  test("with no filter they come last", () => {
    expect(
      ranked([stranger("alpha"), candidate("zeta"), candidate("beta")], ""),
    ).toEqual(["#beta", "#zeta", "#alpha"]);
  });

  test("with no filter they come last even when recently opened, ordered among themselves by recency and unread", () => {
    const candidates = [
      stranger("alpha"),
      stranger("omega"),
      { ...stranger("loud"), markers: { isUnread: true, mentions: 0 } },
      candidate("zeta"),
      candidate("beta"),
    ];

    expect(ranked(candidates, "", ["id:alpha", "id:beta"])).toEqual([
      "#beta",
      "#zeta",
      "#alpha",
      "#loud",
      "#omega",
    ]);
  });
});
