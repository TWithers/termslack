import { join } from "node:path";

/** Loads the envelope payloads stored in `tests/fixtures/<name>.json`. */
export async function loadFixture(
  name: string,
): Promise<Record<string, any>[]> {
  return Bun.file(
    join(import.meta.dir, "..", "fixtures", `${name}.json`),
  ).json();
}

/** The first payload in a fixture. */
export async function loadPayload(name: string): Promise<Record<string, any>> {
  const [payload] = await loadFixture(name);

  if (!payload) {
    throw new Error(`Fixture ${name} is empty`);
  }

  return payload;
}
