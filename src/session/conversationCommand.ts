/**
 * What a session command answers. Never rejects: a refusal says why in words
 * fit for the status bar. `Done` is what a success carries.
 */
export type CommandResult<Done extends object = object> =
  ({ ok: true } & Done) | { ok: false; message: string };

/** A command that ends with a conversation to go to. */
export type ConversationResult = CommandResult<{ conversationId: string }>;

/** Makes concurrent calls for the same key share one run, so Slack is asked once. */
export function dedupeByKey<Result>(
  run: (key: string) => Promise<Result>,
): (key: string) => Promise<Result> {
  const pending = new Map<string, Promise<Result>>();

  return (key) => {
    const running =
      pending.get(key) ?? run(key).finally(() => pending.delete(key));

    pending.set(key, running);

    return running;
  };
}

/**
 * Calls Slack unless the feature is off (`problem`), answering a failure in
 * the command's own words. The success carries what the call returned.
 */
export async function callSlack<Value>({
  problem,
  call,
  describe,
}: {
  /** Why the feature is off (a missing scope), or undefined. */
  problem: string | undefined;
  call: () => Promise<Value>;
  describe: (error: unknown) => string;
}): Promise<{ ok: true; value: Value } | { ok: false; message: string }> {
  if (problem) {
    return { ok: false, message: problem };
  }

  try {
    return { ok: true, value: await call() };
  } catch (error) {
    return { ok: false, message: describe(error) };
  }
}
