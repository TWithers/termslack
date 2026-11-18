import {
  createWorkspaceSession,
  type DmActivityOptions,
  type UnreadCheckOptions,
  type Notification,
  type WorkspaceSession,
} from "../../src/session/workspaceSession";
import type { SectionConfig } from "../../src/config/config";
import type {
  MuteMemory,
  NotificationLevelMemory,
  SectionsMemory,
} from "../../src/config/state";
import type { PresenceOptions } from "../../src/session/presence";
import type { Clock } from "../../src/session/clock";
import type { SessionEvent, SlackEvent } from "../../src/session/events";
import { type FakeSlack, startFakeSlack, waitFor } from "./fakeSlack";

export type SessionHarness = {
  slack: FakeSlack;
  session: WorkspaceSession;
  /** Every event the session published, in order. */
  events: SessionEvent[];
  /** Every notification the session sent, in order. */
  notifications: Notification[];
  /** Sends an `events_api` envelope and resolves with the Slack event the session reports for it. */
  sendEvents(payload: Record<string, any>): Promise<SlackEvent>;
  /** Sends an envelope of any type and resolves with the Slack event the session reports for it. */
  sendEnvelope(type: string, payload: Record<string, any>): Promise<SlackEvent>;
  stop(): Promise<void>;
};

let envelopeCounter = 0;

/** Starts fake Slack and a connected workspace session pointed at it. */
export async function startSessionHarness(
  options: {
    appToken?: string;
    userToken?: string;
    clientPingTimeout?: number;
    /** How long an event waits for names before publishing with raw IDs. */
    nameWaitMs?: number;
    /** How many messages the store keeps per conversation. */
    maxMessagesPerConversation?: number;
    /** Waits between retries of a failed startup listing. Default: the session's own. */
    listingRetryDelaysMs?: number[];
    /** Turns on the DM activity pass (see `SessionOptions.dmActivity`). Default: off. */
    dmActivity?: DmActivityOptions;
    /** Turns on the pre-existing unread check (see `SessionOptions.unreadCheck`). Default: off. */
    unreadCheck?: UnreadCheckOptions;
    /** Where muted channels are remembered (see `SessionOptions.muteMemory`). Default: nothing. */
    muteMemory?: MuteMemory;
    /** Where per-channel notification levels are remembered (see `SessionOptions.notificationLevelMemory`). Default: nothing. */
    notificationLevelMemory?: NotificationLevelMemory;
    /** The sections `config.toml` names (see `SessionOptions.configuredSections`). Default: none. */
    configuredSections?: SectionConfig[];
    /** Where the sections termslack keeps are remembered (see `SessionOptions.sectionsMemory`). Default: nothing. */
    sectionsMemory?: SectionsMemory;
    /** How long marking the open conversation read waits to coalesce. Default: the session's own. */
    readMarkDebounceMs?: number;
    /** The clock the notification logic runs on (see `SessionOptions.clock`). Default: the real one. */
    clock?: Clock;
    /** How long notifications are gathered into one. Default: the session's own. */
    notificationWindowMs?: number;
    /** The least time between notifications. Default: none, so tests see each window's burst; the session's own is 5 s. */
    notificationIntervalMs?: number;
    /** The presence polling budget (see `SessionOptions.presence`). Default: the session's own. */
    presence?: PresenceOptions;
    /** Runs after fake Slack starts and before the session does, e.g. to register handlers. */
    prepare?: (slack: FakeSlack) => void | Promise<void>;
  } = {},
): Promise<SessionHarness> {
  const slack = startFakeSlack();

  process.env.TERMSLACK_SLACK_API_URL = slack.apiUrl;

  await options.prepare?.(slack);

  const session = createWorkspaceSession(
    options.appToken ?? "xapp-test",
    options.userToken ?? "xoxp-test",
    { clientPingTimeout: options.clientPingTimeout },
    {
      nameWaitMs: options.nameWaitMs,
      maxMessagesPerConversation: options.maxMessagesPerConversation,
      listingRetryDelaysMs: options.listingRetryDelaysMs,
      dmActivity: options.dmActivity,
      unreadCheck: options.unreadCheck,
      muteMemory: options.muteMemory,
      notificationLevelMemory: options.notificationLevelMemory,
      configuredSections: options.configuredSections,
      sectionsMemory: options.sectionsMemory,
      readMarkDebounceMs: options.readMarkDebounceMs,
      clock: options.clock,
      notificationWindowMs: options.notificationWindowMs,
      notificationIntervalMs: options.notificationIntervalMs ?? 0,
      presence: options.presence,
    },
  );
  const events: SessionEvent[] = [];
  const notifications: Notification[] = [];

  session.subscribe((event) => events.push(event));
  session.subscribeToNotifications((notification) =>
    notifications.push(notification),
  );

  await session.start();

  async function sendEnvelope(
    type: string,
    payload: Record<string, any>,
  ): Promise<SlackEvent> {
    const seen = events.length;

    slack.send({
      type,
      envelope_id: `envelope-${++envelopeCounter}`,
      payload,
      accepts_response_payload: false,
    });

    return waitFor(() =>
      events
        .slice(seen)
        .find((event): event is SlackEvent => event.kind !== "connection"),
    );
  }

  return {
    slack,
    session,
    events,
    notifications,
    sendEnvelope,
    sendEvents: (payload) => sendEnvelope("events_api", payload),
    async stop() {
      await session.stop();
      await slack.stop();
      delete process.env.TERMSLACK_SLACK_API_URL;
    },
  };
}
