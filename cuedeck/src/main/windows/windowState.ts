import fs from 'node:fs';
import path from 'node:path';
import {
  readJsonFile,
  renameBackoffMs,
  RENAME_ATTEMPTS,
  tempPathFor,
  writeJsonFile,
} from '../storage/jsonFile';
import { sanitizeRect, type Rect } from './placement';

interface WindowStateFile {
  version: 1;
  coach: Rect | null;
}

/**
 * Remembers where the user last put the coach window. Kept out of the
 * public settings on purpose: it is main-process housekeeping, not a
 * preference the renderer should read or patch.
 */
export class WindowStateStore {
  private readonly filePath: string;
  private pending: NodeJS.Timeout | null = null;
  private latest: Rect | null = null;

  constructor(
    userDataDir: string,
    private readonly reportCorrupt?: (file: string, quarantinePath: string) => void,
  ) {
    this.filePath = path.join(userDataDir, 'window-state.json');
  }

  async loadCoachBounds(): Promise<Rect | null> {
    const raw = (await readJsonFile(this.filePath, {
      onCorrupt: (q) => this.reportCorrupt?.('window-state.json', q),
    }).catch(() => null)) as WindowStateFile | null;
    if (!raw || raw.version !== 1) return null;
    return sanitizeRect(raw.coach);
  }

  /** Debounced: window move/resize events fire dozens of times per second. */
  rememberCoachBounds(bounds: Rect): void {
    this.latest = bounds;
    if (this.pending) clearTimeout(this.pending);
    this.pending = setTimeout(() => void this.flush(), 400);
  }

  private cancelPending(): void {
    if (this.pending) {
      clearTimeout(this.pending);
      this.pending = null;
    }
  }

  async flush(): Promise<void> {
    this.cancelPending();
    if (!this.latest) return;
    const file: WindowStateFile = { version: 1, coach: this.latest };
    await writeJsonFile(this.filePath, file).catch(() => undefined);
  }

  /**
   * Synchronous write for the window `close` path: `window-all-closed`
   * quits without waiting, so an async write could still be pending when
   * the process exits. Same temp-file-then-rename pattern as writeJsonFile.
   */
  flushSync(): void {
    this.cancelPending();
    if (!this.latest) return;
    const file: WindowStateFile = { version: 1, coach: this.latest };
    const tmp = tempPathFor(this.filePath);
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify(file, null, 2), 'utf8');
      for (let attempt = 0; attempt < RENAME_ATTEMPTS; attempt++) {
        try {
          fs.renameSync(tmp, this.filePath);
          this.latest = null;
          return;
        } catch {
          // Windows can transiently lock the rename target; wait briefly.
          sleepSync(renameBackoffMs(attempt));
        }
      }
    } catch {
      // Best effort: losing the last position is not worth failing a close.
    }
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      // ignore
    }
  }
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
