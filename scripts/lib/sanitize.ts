/**
 * Replaces everything identifying in captured Slack payloads with
 * placeholders. The same real value always maps to the same placeholder
 * within one `Sanitizer`, so references between payloads still match.
 */

const textKeys = new Set([
  "text",
  "fallback",
  "title",
  "pretext",
  "preview",
  "plain_text",
  "value",
  "status_text",
]);

const nameKeys = new Set([
  "name",
  "real_name",
  "display_name",
  "username",
  "user_name",
  "team_name",
  "domain",
  "email",
  "title_link",
]);

const opaqueKeys = new Set([
  "token",
  "envelope_id",
  "event_id",
  "client_msg_id",
  "trigger_id",
  "block_id",
  "hash",
  "team_domain",
]);

/** U123ABC456, C07MZ2P4HJ5, BB12033: a letter class prefix and an uppercase alphanumeric body with a digit. */
const slackId = /^[UWBCGDTAFSRL][A-Z0-9]{5,}$/;

/** mrkdwn tokens like `<@U123>`, `<#C123|name>`, `<!subteam^S123>`, `<https://x|label>`. */
const markup = /<[^<>]*>/g;

export class Sanitizer {
  private placeholders = new Map<string, string>();
  private counters = new Map<string, number>();

  sanitize<T>(value: T): T {
    return this.walk(value, undefined) as T;
  }

  private placeholder(
    category: string,
    real: string,
    make: (n: number) => string,
  ): string {
    const key = `${category}\0${real}`;
    const existing = this.placeholders.get(key);

    if (existing) {
      return existing;
    }

    const next = (this.counters.get(category) ?? 0) + 1;
    const created = make(next);

    this.counters.set(category, next);
    this.placeholders.set(key, created);

    return created;
  }

  private id(real: string): string {
    const prefix = real[0] ?? "X";

    return this.placeholder(
      `id:${prefix}`,
      real,
      (n) => `${prefix}${String(n).padStart(8, "0")}`,
    );
  }

  private sanitizeMarkup(token: string): string {
    const [target = "", label] = token.slice(1, -1).split("|");
    const reference = /^https?:\/\//.test(target)
      ? this.url(target)
      : target.replace(/[A-Z][A-Z0-9]{5,}/g, (match) =>
          slackId.test(match) ? this.id(match) : match,
        );

    // Labels after `|` are real names: `<#C123|general>` -> `<#C00000001|name 1>`.
    return label === undefined
      ? `<${reference}>`
      : `<${reference}|${this.placeholder("name", label, (n) => `name ${n}`)}>`;
  }

  private url(real: string): string {
    return this.placeholder("url", real, (n) => `https://example.invalid/${n}`);
  }

  private text(real: string): string {
    if (real === "") {
      return real;
    }

    const tokens = real.match(markup) ?? [];
    const plain = real.replace(markup, "").trim();
    const placeholder =
      plain === ""
        ? ""
        : this.placeholder("text", plain, (n) => `message text ${n}`);

    return [placeholder, ...tokens.map((token) => this.sanitizeMarkup(token))]
      .filter(Boolean)
      .join(" ");
  }

  private walk(value: unknown, key: string | undefined): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.walk(item, key));
    }

    if (typeof value === "object" && value !== null) {
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, this.walk(v, k)]),
      );
    }

    if (typeof value !== "string") {
      return value;
    }

    if (key && opaqueKeys.has(key)) {
      return this.placeholder(`opaque:${key}`, value, (n) => `${key}-${n}`);
    }

    if (key && textKeys.has(key)) {
      return this.text(value);
    }

    if (key && nameKeys.has(key)) {
      return this.placeholder("name", value, (n) => `name ${n}`);
    }

    if (/^xox[a-z]-|^xapp-/.test(value)) {
      return "xoxb-REDACTED";
    }

    if (/^https?:\/\//.test(value)) {
      return this.url(value);
    }

    if (slackId.test(value) && /\d/.test(value)) {
      return this.id(value);
    }

    return value;
  }
}

/** Parses `--raw` output (one JSON body per line; other lines are ignored) and sanitizes each body. */
export function sanitizeCapture(capture: string): Record<string, any>[] {
  const sanitizer = new Sanitizer();
  const bodies: Record<string, any>[] = [];

  for (const line of capture.split("\n")) {
    if (!line.trim().startsWith("{")) {
      continue;
    }

    try {
      bodies.push(sanitizer.sanitize(JSON.parse(line)));
    } catch {
      continue;
    }
  }

  return bodies;
}
