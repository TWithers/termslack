/** What a lookup of one ID came back with. */
export type LookupResult<T> =
  | { status: "found"; value: T }
  /** Slack definitely doesn't know it, or we have no access: don't ask again. */
  | { status: "unresolvable" }
  /** Something temporary went wrong: fall back for now, ask again next time. */
  | { status: "failed" };

export type NameResolverOptions<T> = {
  /** The answer already in the store, if any. */
  known(id: string): T | undefined;
  isUnresolvable(id: string): boolean;
  lookup(id: string): Promise<LookupResult<T>>;
  remember(value: T): void;
  markUnresolvable(id: string): void;
};

export type NameResolver<T> = {
  /**
   * Resolves an ID from the store, or looks it up. Simultaneous requests for
   * the same ID share one lookup. Resolves undefined when it can't be
   * resolved; never rejects.
   */
  resolve(id: string): Promise<T | undefined>;
};

/** Generic on-demand lookup used for each kind of ID (conversations now; users and groups later). */
export function createNameResolver<T>(
  options: NameResolverOptions<T>,
): NameResolver<T> {
  const inFlight = new Map<string, Promise<T | undefined>>();

  async function lookUp(id: string): Promise<T | undefined> {
    try {
      const result = await options.lookup(id);

      if (result.status === "found") {
        options.remember(result.value);

        return result.value;
      }

      if (result.status === "unresolvable") {
        options.markUnresolvable(id);
      }
    } catch {
      // A failed lookup just means the caller shows the raw ID.
    }

    return undefined;
  }

  return {
    async resolve(id) {
      if (id === "") {
        return undefined;
      }

      const known = options.known(id);

      if (known !== undefined) {
        return known;
      }

      if (options.isUnresolvable(id)) {
        return undefined;
      }

      let pending = inFlight.get(id);

      if (!pending) {
        pending = lookUp(id).finally(() => inFlight.delete(id));
        inFlight.set(id, pending);
      }

      return pending;
    },
  };
}
