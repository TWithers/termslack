#!/usr/bin/env bun
/**
 * Turns captured `termslack --raw` output into sanitized test fixtures.
 *
 *   bun start --raw > capture.jsonl
 *   bun scripts/sanitize-fixtures.ts capture.jsonl tests/fixtures/message.json
 *
 * Use `-` as the input to read stdin.
 */
import { sanitizeCapture } from "./lib/sanitize";

const [input, output] = process.argv.slice(2);

if (!input || !output) {
  console.error(
    "Usage: bun scripts/sanitize-fixtures.ts <capture.jsonl|-> <fixture.json>",
  );
  process.exit(1);
}

const capture =
  input === "-" ? await Bun.stdin.text() : await Bun.file(input).text();
const fixtures = sanitizeCapture(capture);

await Bun.write(output, `${JSON.stringify(fixtures, null, 2)}\n`);

console.log(`Wrote ${fixtures.length} sanitized payload(s) to ${output}`);
