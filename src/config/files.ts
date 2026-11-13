import { chmod, mkdir, rename } from "node:fs/promises";
import { dirname } from "node:path";

export async function readToml<T>(path: string, fallback: T): Promise<T> {
  const file = Bun.file(path);

  if (!(await file.exists())) {
    return fallback;
  }

  return Bun.TOML.parse(await file.text()) as T;
}

/**
 * Writes to a temp file and renames it into place, so a crash mid-write
 * never leaves a truncated config (or a lost refresh token) behind.
 */
export async function writeTextAtomic(
  path: string,
  text: string,
  mode = 0o600,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });

  const tempPath = `${path}.${process.pid}.tmp`;

  await Bun.write(tempPath, text);
  await chmod(tempPath, mode);
  await rename(tempPath, path);
}

export async function writeTomlAtomic(
  path: string,
  data: object,
  mode = 0o600,
): Promise<void> {
  await writeTextAtomic(path, Bun.TOML.stringify(data), mode);
}
