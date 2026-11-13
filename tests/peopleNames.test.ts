import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { conversationTitle } from "../src/session/people";
import { logSession } from "../src/ui/eventLog";
import { waitFor } from "./support/fakeSlack";
import { loadFixture, loadPayload } from "./support/fixtures";
import {
  type SessionHarness,
  startSessionHarness,
} from "./support/sessionHarness";

let harness: SessionHarness;
let lines: string[];
let spy: ReturnType<typeof spyOn>;

beforeEach(() => {
  lines = [];
  spy = spyOn(console, "log").mockImplementation((line: string) => {
    lines.push(line);
  });
});

afterEach(async () => {
  await harness.stop();
  spy.mockRestore();
});

const plain = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, "");
const lastLine = () => plain(lines.at(-1) ?? "");

/** Starts a session that has loaded the channels, the group DM and two DMs. */
async function startLoaded(
  options: Parameters<typeof startSessionHarness>[0] = {},
) {
  const pages = [
    ...(await loadFixture("users-conversations-channels")),
    ...(await loadFixture("users-conversations-dms")),
  ];

  harness = await startSessionHarness({
    ...options,
    prepare(slack) {
      slack.respondPaged("users.conversations", pages);
      options.prepare?.(slack);
    },
  });

  logSession(harness.session, false);

  await waitFor(() => harness.session.conversation("D0BSHH4AD"));
}

/** A `users.info` response for `id` based on the documented example. */
async function userResponse(
  id: string,
  profile: Record<string, string> = {},
  fields: Record<string, unknown> = {},
) {
  const [response] = await loadFixture("users-info");

  return {
    ...response,
    user: {
      ...response?.user,
      id,
      ...fields,
      profile: { ...response?.user.profile, ...profile },
    },
  };
}

function respondWithUsers(responses: Record<string, Record<string, any>>) {
  harness.slack.respond("users.info", (call) => {
    return (
      responses[String(call.params.user)] ?? {
        ok: false,
        error: "user_not_found",
      }
    );
  });
}

const callsTo = (method: string) =>
  harness.slack.calls.filter((call) => call.method === method);

function message(
  user: string | undefined,
  channel = "C012AB3CD",
  extra: Record<string, unknown> = {},
  ts = "1355517523.000005",
) {
  return {
    event: {
      type: "message",
      channel,
      ...(user ? { user } : {}),
      text: "Hello",
      ts,
      channel_type: "channel",
      ...extra,
    },
  };
}

test("an author is shown by display name, found by one lookup", async () => {
  await startLoaded();
  respondWithUsers({
    U123ABC456: await userResponse("U123ABC456", { display_name: "egon" }),
  });

  await harness.sendEvents(message("U123ABC456"));

  expect(lastLine()).toMatch(/ message +#general egon: Hello$/);
  expect(callsTo("users.info")).toHaveLength(1);
  expect(callsTo("users.info")[0]?.params.user).toBe("U123ABC456");
  expect(harness.session.user("U123ABC456")).toMatchObject({
    id: "U123ABC456",
    displayName: "egon",
    realName: "Egon Spengler",
    name: "spengler",
  });
});

test("names fall back from display name to real name to username", async () => {
  await startLoaded();
  respondWithUsers({
    U1: await userResponse("U1", { display_name: "", real_name: "Real One" }),
    U2: await userResponse(
      "U2",
      { display_name: "", real_name: "" },
      { name: "handle2", real_name: "" },
    ),
  });

  await harness.sendEvents(message("U1"));
  expect(lastLine()).toMatch(/#general Real One: /);

  await harness.sendEvents(message("U2"));
  expect(lastLine()).toMatch(/#general handle2: /);
});

test("simultaneous events from an unknown person share one lookup, later ones reuse it", async () => {
  await startLoaded({
    prepare: (slack) =>
      slack.respond("users.info", async () => {
        await Bun.sleep(30);

        return userResponse("U123ABC456", { display_name: "egon" });
      }),
  });

  for (const ts of ["1.1", "1.2", "1.3"]) {
    harness.slack.send({
      type: "events_api",
      envelope_id: `e-${ts}`,
      payload: message("U123ABC456", "C012AB3CD", {}, ts),
    });
  }

  await waitFor(
    () => lines.filter((l) => plain(l).includes("egon")).length === 3,
  );
  await harness.sendEvents(message("U123ABC456", "C012AB3CD", {}, "1.4"));

  expect(lastLine()).toMatch(/egon: /);
  expect(callsTo("users.info")).toHaveLength(1);
});

test("a person who can't be resolved shows their raw ID and isn't asked about again", async () => {
  await startLoaded();

  await harness.sendEvents(message("U0GHOST001"));
  await harness.sendEvents(message("U0GHOST001", "C012AB3CD", {}, "1.2"));

  expect(lastLine()).toMatch(/#general U0GHOST001: /);
  expect(callsTo("users.info")).toHaveLength(1);
  expect(harness.session.user("U0GHOST001")).toBeUndefined();
});

test("a temporary failure falls back to the ID and is retried next time", async () => {
  await startLoaded();
  harness.slack.respond("users.info", () => ({
    ok: false,
    error: "internal_error",
  }));

  await harness.sendEvents(message("U123ABC456"));
  await harness.sendEvents(message("U123ABC456", "C012AB3CD", {}, "1.2"));
  expect(callsTo("users.info")).toHaveLength(2);

  respondWithUsers({
    U123ABC456: await userResponse("U123ABC456", { display_name: "egon" }),
  });
  await harness.sendEvents(message("U123ABC456", "C012AB3CD", {}, "1.3"));

  expect(lastLine()).toMatch(/egon: /);
});

test("reaction, edit and join events show names too", async () => {
  await startLoaded();
  respondWithUsers({
    U123ABC456: await userResponse("U123ABC456", { display_name: "egon" }),
  });

  await harness.sendEvents(await loadPayload("reaction-added"));
  expect(lastLine()).toMatch(/reaction_added +C123ABC456 egon \+👍/);

  await harness.sendEvents(await loadPayload("message-changed"));
  expect(lastLine()).toMatch(/ message +C123ABC456 egon edited: /);

  await harness.sendEvents(await loadPayload("member-joined-channel"));
  expect(lastLine()).toMatch(/ by egon$/);
});

test("a bot message shows the name the message carries, without a lookup", async () => {
  await startLoaded();

  await harness.sendEvents(await loadPayload("bot-message"));
  expect(lastLine()).toMatch(/ message +\? github \(bot_message\): Pushing/);

  await harness.sendEvents(
    message(undefined, "C012AB3CD", {
      subtype: "bot_message",
      bot_id: "B0PROFILE",
      bot_profile: { id: "B0PROFILE", name: "deploybot" },
    }),
  );
  expect(lastLine()).toMatch(/#general deploybot \(bot_message\): /);
  expect(callsTo("bots.info")).toHaveLength(0);
});

test("a bot message with only a bot_id is looked up once with bots.info", async () => {
  await startLoaded();

  const [botInfo] = await loadFixture("bots-info");

  harness.slack.respond("bots.info", () => botInfo ?? {});

  for (const ts of ["1.1", "1.2"]) {
    await harness.sendEvents(
      message(
        undefined,
        "C012AB3CD",
        { subtype: "bot_message", bot_id: "BB12033" },
        ts,
      ),
    );
    expect(lastLine()).toMatch(/#general github \(bot_message\): /);
  }

  expect(callsTo("bots.info")).toHaveLength(1);
  expect(callsTo("bots.info")[0]?.params.bot).toBe("BB12033");
  expect(harness.session.bot("BB12033")).toMatchObject({ name: "github" });
});

test("an unknown bot shows its ID and isn't looked up again", async () => {
  await startLoaded();

  for (const ts of ["1.1", "1.2"]) {
    await harness.sendEvents(
      message(
        undefined,
        "C012AB3CD",
        { subtype: "bot_message", bot_id: "B0NOBODY" },
        ts,
      ),
    );
  }

  expect(lastLine()).toMatch(/#general B0NOBODY \(bot_message\): /);
  expect(callsTo("bots.info")).toHaveLength(1);
});

test("a DM is labelled @ and the other person's name", async () => {
  await startLoaded();
  respondWithUsers({
    U222222222: await userResponse("U222222222", { display_name: "venkman" }),
    U123ABC456: await userResponse("U123ABC456", { display_name: "egon" }),
  });

  await harness.sendEvents(
    message("U222222222", "D0C0F7S8Y", { channel_type: "im" }),
  );

  expect(lastLine()).toMatch(/ message +@venkman venkman: Hello$/);
});

test("a DM with someone unresolvable shows @ and their ID", async () => {
  await startLoaded();

  await harness.sendEvents(
    message("U333333333", "D0BSHH4AD", { channel_type: "im" }),
  );

  expect(lastLine()).toMatch(/ message +@U333333333 U333333333: Hello$/);
});

test("a group DM is labelled by its other members' names, looked up once", async () => {
  await startLoaded();

  const [members] = await loadFixture("conversations-members-mpim");

  harness.slack.respond("conversations.members", () => members ?? {});
  respondWithUsers({
    U123ABC456: await userResponse("U123ABC456", { display_name: "egon" }),
    U222222222: await userResponse("U222222222", { display_name: "venkman" }),
    U333333333: await userResponse("U333333333", { display_name: "ray" }),
  });

  for (const ts of ["1.1", "1.2"]) {
    await harness.sendEvents(
      message("U222222222", "G0AKFJBEU", { channel_type: "mpim" }, ts),
    );
  }

  expect(lastLine()).toMatch(/ message +@venkman, ray venkman: Hello$/);
  expect(callsTo("conversations.members")).toHaveLength(1);
  expect(callsTo("conversations.members")[0]?.params.channel).toBe("G0AKFJBEU");
  expect(harness.session.conversationMembers("G0AKFJBEU")).toEqual([
    "U123ABC456",
    "U222222222",
    "U333333333",
  ]);
});

test("a group DM whose members can't be listed keeps its ID and isn't retried", async () => {
  await startLoaded();

  for (const ts of ["1.1", "1.2"]) {
    await harness.sendEvents(
      message("U222222222", "G0AKFJBEU", { channel_type: "mpim" }, ts),
    );
  }

  expect(lastLine()).toMatch(/ message +@G0AKFJBEU U222222222: /);
  expect(callsTo("conversations.members")).toHaveLength(1);
});

test("the user list loads page by page without blocking the log", async () => {
  const pages = await loadFixture("users-list");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));

  harness = await startSessionHarness({
    prepare(slack) {
      slack.respondPaged("users.list", pages);
      slack.respond("users.list", async (call) => {
        await gate;

        return call.params.cursor ? (pages[1] ?? {}) : (pages[0] ?? {});
      });
    },
  });
  logSession(harness.session, false);

  await harness.sendEvents(message("U0GHOST001"));
  expect(lastLine()).toMatch(/#C012AB3CD U0GHOST001: /);
  expect(harness.session.users()).toHaveLength(0);

  release();

  await waitFor(() => harness.session.users().length === 4);

  const listing = callsTo("users.list");

  expect(listing).toHaveLength(2);
  expect(listing[1]?.params.cursor).toBe("dXNlcjpVMEc5V0ZYTlo=");
  expect(harness.session.user("U222222222")).toMatchObject({
    realName: "Peter Venkman",
    status: { emoji: ":calendar:", text: "In a meeting" },
  });

  await harness.sendEvents(message("U222222222", "C012AB3CD", {}, "1.2"));

  expect(lastLine()).toMatch(/#C012AB3CD Peter Venkman: /);
  expect(callsTo("users.info")).toHaveLength(1);
});

test("a user_change updates the name for the next event", async () => {
  await startLoaded();
  respondWithUsers({
    U123ABC456: await userResponse("U123ABC456", { display_name: "egon" }),
  });
  await harness.sendEvents(message("U123ABC456"));

  expect(
    await harness.sendEvents(await loadPayload("user-change")),
  ).toMatchObject({
    kind: "user",
    action: "changed",
    userId: "U123ABC456",
  });
  expect(harness.session.user("U123ABC456")).toMatchObject({
    displayName: "doc",
    realName: "Dr. Egon Spengler",
  });

  await harness.sendEvents(message("U123ABC456", "C012AB3CD", {}, "1.2"));

  expect(lastLine()).toMatch(/#general doc: /);
  expect(callsTo("users.info")).toHaveLength(1);
});

test("profile and status events merge into what the store already knows", async () => {
  await startLoaded();
  respondWithUsers({
    U123ABC456: await userResponse("U123ABC456", { display_name: "egon" }),
  });
  await harness.sendEvents(message("U123ABC456"));

  await harness.sendEvents(await loadPayload("user-profile-changed"));
  expect(lastLine()).toMatch(
    /user_profile_changed +egon the great updated their profile$/,
  );
  expect(harness.session.user("U123ABC456")).toMatchObject({
    displayName: "egon the great",
    status: { emoji: ":books:", text: "Print is dead" },
  });

  await harness.sendEvents(await loadPayload("user-status-changed"));
  expect(lastLine()).toMatch(
    /user_status_changed +egon the great status: 🌴 On holiday$/,
  );
  expect(harness.session.user("U123ABC456")).toMatchObject({
    displayName: "egon the great",
    status: { emoji: ":palm_tree:", text: "On holiday" },
  });

  const cleared = await loadPayload("user-status-changed");

  cleared.event.user.profile.status_text = "";
  cleared.event.user.profile.status_emoji = "";
  await harness.sendEvents(cleared);

  expect(lastLine()).toMatch(/egon the great cleared their status$/);
  expect(harness.session.user("U123ABC456")?.status).toEqual({
    emoji: "",
    text: "",
  });
});

test("team_join adds the new person without a lookup", async () => {
  await startLoaded();

  await harness.sendEvents(await loadPayload("team-join"));
  expect(lastLine()).toMatch(/team_join +louis joined the workspace$/);

  await harness.sendEvents(message("U555555555"));

  expect(lastLine()).toMatch(/#general louis: /);
  expect(callsTo("users.info")).toHaveLength(0);
});

test("a user event without an ID is reported, not applied", async () => {
  await startLoaded();

  const event = await harness.sendEvents({ event: { type: "user_change" } });

  expect(event).toMatchObject({ kind: "user", userId: "" });
  expect(event.issues).toContain("missing user.id");
  expect(harness.session.users()).toHaveLength(0);
});

test("a slow lookup doesn't hold up events: they publish with raw IDs, in order, and later ones show the name", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));

  await startLoaded({
    nameWaitMs: 50,
    prepare: (slack) =>
      slack.respond("users.info", async (call) => {
        if (call.params.user === "U0SLOW0001") {
          await gate;

          return userResponse("U0SLOW0001", { display_name: "slowpoke" });
        }

        return { ok: false, error: "user_not_found" };
      }),
  });

  const started = Date.now();

  for (const [ts, user] of [
    ["1.1", "U0SLOW0001"],
    ["1.2", "U0SLOW0001"],
    ["1.3", "U0OTHER001"],
  ] as const) {
    harness.slack.send({
      type: "events_api",
      envelope_id: `e-${ts}`,
      payload: message(user, "C012AB3CD", {}, ts),
    });
  }

  await waitFor(() => lines.length >= 3);

  expect(Date.now() - started).toBeLessThan(1000);
  expect(lines.map((line) => plain(line).replace(/^.*#general /, ""))).toEqual([
    "U0SLOW0001: Hello",
    "U0SLOW0001: Hello",
    "U0OTHER001: Hello",
  ]);

  release();
  await waitFor(() => harness.session.user("U0SLOW0001"));
  await harness.sendEvents(message("U0SLOW0001", "C012AB3CD", {}, "1.4"));

  expect(lastLine()).toMatch(/#general slowpoke: /);
  expect(
    callsTo("users.info").filter((c) => c.params.user === "U0SLOW0001"),
  ).toHaveLength(1);
});

test("a conversation's title carries the sigil its kind takes", () => {
  expect(conversationTitle("channel", "general")).toBe("#general");
  expect(conversationTitle("group", "secret")).toBe("#secret");
  expect(conversationTitle("im", "sarah")).toBe("@sarah");
  expect(conversationTitle("mpim", "sarah, ray")).toBe("@sarah, ray");
});
