import type { ServerWebSocket } from "bun";

export type ApiCall = {
  method: string;
  token?: string;
  params: Record<string, unknown>;
};

type ApiAnswer = Record<string, unknown> | Response;

/** A plain object is sent as the JSON body; a `Response` is sent as it is (to fake a transport failure, say). */
type ApiHandler = (call: ApiCall) => ApiAnswer | Promise<ApiAnswer>;

export type FakeSlack = {
  /** Pass to TERMSLACK_SLACK_API_URL. */
  apiUrl: string;
  /** Every Web API call received, in order. */
  calls: ApiCall[];
  /** Every message clients sent over the socket (acks), parsed. */
  socketMessages: Record<string, any>[];
  /**
   * The scopes Slack reports the token has, in the `x-oauth-scopes` header of
   * every response, as the real API does. Without a call, no header is sent.
   */
  grantScopes(scopes: string[]): void;
  /** Overrides the response for a Web API method. */
  respond(method: string, handler: ApiHandler): void;
  /** The current handler for a Web API method, e.g. to wrap it. */
  handler(method: string): ApiHandler;
  /**
   * Answers a method with consecutive pages of a listing: the first page when
   * no cursor is sent, then the page that follows the one whose
   * `response_metadata.next_cursor` matches the cursor sent.
   */
  respondPaged(method: string, pages: Record<string, any>[]): void;
  /** Sends a frame to the most recently opened socket. */
  send(message: object): void;
  stop(): Promise<void>;
};

async function readParams(request: Request): Promise<Record<string, unknown>> {
  const body = await request.text();

  if (!body) {
    return {};
  }

  if (request.headers.get("content-type")?.includes("application/json")) {
    return JSON.parse(body);
  }

  return Object.fromEntries(new URLSearchParams(body));
}

/**
 * A minimal stand-in for slack.com: Web API methods over HTTP plus a Socket
 * Mode websocket that greets with `hello`, like the real one.
 */
export function startFakeSlack(): FakeSlack {
  const handlers = new Map<string, ApiHandler>();
  const calls: ApiCall[] = [];
  const socketMessages: Record<string, any>[] = [];
  const sockets: ServerWebSocket<unknown>[] = [];

  let scopes: string[] | undefined;

  const scopeHeaders = (): Record<string, string> =>
    scopes ? { "x-oauth-scopes": scopes.join(",") } : {};

  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request, server) {
      const url = new URL(request.url);

      if (url.pathname === "/socket") {
        return server.upgrade(request)
          ? undefined
          : new Response("Upgrade failed", { status: 400 });
      }

      const params = await readParams(request);

      const call: ApiCall = {
        method: url.pathname.replace(/^\/api\//, ""),
        token:
          request.headers.get("authorization")?.replace(/^Bearer /, "") ??
          (params.token as string | undefined),
        params,
      };

      calls.push(call);

      const handler = handlers.get(call.method);

      const answer = handler
        ? await handler(call)
        : { ok: false, error: "unknown_method" };

      return answer instanceof Response
        ? answer
        : Response.json(answer, { headers: scopeHeaders() });
    },
    websocket: {
      open(socket) {
        sockets.push(socket);
        socket.send(JSON.stringify({ type: "hello", num_connections: 1 }));
      },
      message(_socket, message) {
        socketMessages.push(JSON.parse(String(message)));
      },
    },
  });

  handlers.set("apps.connections.open", () => ({
    ok: true,
    url: `ws://127.0.0.1:${server.port}/socket`,
  }));

  handlers.set("auth.test", () => ({
    ok: true,
    team: "Acme",
    user: "tim",
    user_id: "U123ABC456",
  }));
  handlers.set("users.conversations", () => ({ ok: true, channels: [] }));
  handlers.set("conversations.list", () => ({
    ok: true,
    channels: [],
    response_metadata: { next_cursor: "" },
  }));
  handlers.set("dnd.info", () => ({
    ok: true,
    dnd_enabled: false,
    next_dnd_start_ts: 1,
    next_dnd_end_ts: 1,
    snooze_enabled: false,
  }));
  handlers.set("conversations.info", () => ({
    ok: false,
    error: "channel_not_found",
  }));

  handlers.set("conversations.replies", () => ({
    ok: false,
    error: "thread_not_found",
  }));

  handlers.set("conversations.mark", () => ({ ok: true }));
  handlers.set("conversations.leave", () => ({ ok: true }));

  let postedCount = 0;

  // Posts as the user from auth.test, with ts values that count up from 1700000000.000001.
  handlers.set("chat.postMessage", (call) => {
    const ts = `1700000000.${String(++postedCount).padStart(6, "0")}`;

    return {
      ok: true,
      channel: call.params.channel,
      ts,
      message: {
        type: "message",
        user: "U123ABC456",
        text: call.params.text,
        ts,
        thread_ts: call.params.thread_ts,
      },
    };
  });
  handlers.set("chat.update", (call) => ({
    ok: true,
    channel: call.params.channel,
    ts: call.params.ts,
    text: call.params.text,
  }));
  handlers.set("chat.delete", (call) => ({
    ok: true,
    channel: call.params.channel,
    ts: call.params.ts,
  }));
  handlers.set("reactions.add", () => ({ ok: true }));
  handlers.set("reactions.remove", () => ({ ok: true }));
  handlers.set("users.list", () => ({ ok: true, members: [] }));
  handlers.set("users.info", () => ({ ok: false, error: "user_not_found" }));
  handlers.set("users.getPresence", () => ({
    ok: false,
    error: "user_not_found",
  }));
  handlers.set("usergroups.list", () => ({ ok: true, usergroups: [] }));
  handlers.set("emoji.list", () => ({ ok: true, emoji: {} }));
  handlers.set("bots.info", () => ({ ok: false, error: "bot_not_found" }));
  handlers.set("conversations.members", () => ({
    ok: false,
    error: "channel_not_found",
  }));

  return {
    apiUrl: `http://127.0.0.1:${server.port}/api/`,
    calls,
    socketMessages,
    grantScopes: (granted) => {
      scopes = granted;
    },
    respond: (method, handler) => handlers.set(method, handler),
    handler: (method) =>
      handlers.get(method) ?? (() => ({ ok: false, error: "unknown_method" })),
    respondPaged(method, pages) {
      handlers.set(method, (call) => {
        const cursor = call.params.cursor;

        if (!cursor) {
          return pages[0] ?? { ok: true };
        }

        const previous = pages.findIndex(
          (page) => page.response_metadata?.next_cursor === cursor,
        );

        return pages[previous + 1] ?? { ok: false, error: "invalid_cursor" };
      });
    },
    send: (message) => sockets.at(-1)?.send(JSON.stringify(message)),
    stop: () => server.stop(true),
  };
}

/**
 * The `clientPingTimeout` for tests that make the socket reconnect. The Slack
 * SDK uses it both as the delay before reconnecting (why tests shorten it from
 * 5 s) and as how long it waits for a pong: when more time than this passes
 * since the last pong, it drops a healthy connection and reconnects on its
 * own, and events the test sends meanwhile are lost. A test process can freeze
 * for 50 ms or more while it draws the app, so this is set well above that.
 */
export const reconnectPingTimeoutMs = 500;

/** Polls until `check` returns something truthy, or fails after `timeoutMs`. */
export async function waitFor<T>(
  check: () => T | false | undefined | null,
  timeoutMs = 2000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const result = check();

    if (result) {
      return result;
    }

    await Bun.sleep(10);
  }

  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}
