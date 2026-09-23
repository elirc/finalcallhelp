import { promises as fs } from 'node:fs';
import path from 'node:path';
import { CoachError } from '../../shared/errors';

export interface ReadJsonOptions {
  /** Called with the new path after an unreadable file was moved aside. */
  onCorrupt?: (quarantinePath: string) => void;
}

/** `<stem>.corrupt-<timestamp>.json` next to the original file. */
export function quarantinePathFor(filePath: string, now: Date = new Date()): string {
  const stem = path.basename(filePath, path.extname(filePath));
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return path.join(path.dirname(filePath), `${stem}.corrupt-${stamp}.json`);
}

/**
 * Move an unreadable (or unusable) store file aside so the next save cannot
 * overwrite it, and report where it went. Throws STORAGE_FAILED when the
 * rename itself fails, so callers never silently replace the original.
 */
export async function quarantineFile(
  filePath: string,
  onCorrupt?: (quarantinePath: string) => void,
): Promise<string> {
  const target = quarantinePathFor(filePath);
  try {
    await fs.rename(filePath, target);
  } catch {
    throw new CoachError('STORAGE_FAILED', `quarantining ${path.basename(filePath)} failed`);
  }
  onCorrupt?.(target);
  return target;
}

/**
 * Read a JSON file, returning null when it does not exist. A file that is
 * not valid JSON is quarantined (renamed to `<name>.corrupt-<time>.json`)
 * and also reads as null, so callers start from defaults without destroying
 * the original bytes.
 */
export async function readJsonFile(
  filePath: string,
  options: ReadJsonOptions = {},
): Promise<unknown | null> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new CoachError('STORAGE_FAILED', `reading ${path.basename(filePath)} failed`);
  }
  try {
    return JSON.parse(raw);
  } catch {
    await quarantineFile(filePath, options.onCorrupt);
    return null;
  }
}

/** Atomically write JSON: write to a temp file in the same directory, then rename. */
export async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  const tmp = tempPathFor(filePath);
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
    // Windows can transiently lock the rename target (antivirus, indexer);
    // retry briefly before giving up.
    let lastError: unknown;
    for (let attempt = 0; attempt < RENAME_ATTEMPTS; attempt++) {
      try {
        await fs.rename(tmp, filePath);
        return;
      } catch (err) {
        lastError = err;
        await new Promise((resolve) => setTimeout(resolve, renameBackoffMs(attempt)));
      }
    }
    throw lastError;
  } catch {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw new CoachError('STORAGE_FAILED', `writing ${path.basename(filePath)} failed`);
  }
}

export const RENAME_ATTEMPTS = 4;
export const renameBackoffMs = (attempt: number): number => 25 * (attempt + 1);

export function tempPathFor(filePath: string): string {
  return `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
}
