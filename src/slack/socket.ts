import { SocketModeClient, type SocketModeOptions } from "@slack/socket-mode";
import { silentLogger, slackClientOptions } from "./client";

export type SocketStatus =
  "connecting" | "connected" | "reconnecting" | "disconnected";

export type SocketHandlers = {
  onEvent: (type: string, body: Record<string, any>) => void;
  onStatus: (status: SocketStatus, error?: Error) => void;
};

/** `clientPingTimeout` also sets the reconnect delay; tests shorten it. */
export type SocketOptions = Pick<SocketModeOptions, "clientPingTimeout">;

export async function connectSocket(
  appToken: string,
  handlers: SocketHandlers,
  options: SocketOptions = {},
): Promise<SocketModeClient> {
  const client = new SocketModeClient({
    appToken,
    logger: silentLogger,
    clientOptions: slackClientOptions(),
    ...options,
  });

  client.on("connecting", () => handlers.onStatus("connecting"));
  client.on("connected", () => handlers.onStatus("connected"));
  client.on("reconnecting", () => handlers.onStatus("reconnecting"));
  client.on("disconnected", (error?: Error) =>
    handlers.onStatus("disconnected", error),
  );

  client.on("slack_event", async ({ ack, type, body }) => {
    await ack();

    handlers.onEvent(type, body ?? {});
  });

  await client.start();

  return client;
}
