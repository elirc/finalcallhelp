import path from 'node:path';
import { readJsonFile, writeJsonFile } from '../storage/jsonFile';
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

  constructor(userDataDir: string) {
    this.filePath = path.join(userDataDir, 'window-state.json');
  }

  async loadCoachBounds(): Promise<Rect | null> {
    const raw = (await readJsonFile(this.filePath).catch(() => null)) as WindowStateFile | null;
    if (!raw || raw.version !== 1) return null;
    return sanitizeRect(raw.coach);
  }

  /** Debounced: window move/resize events fire dozens of times per second. */
  rememberCoachBounds(bounds: Rect): void {
    this.latest = bounds;
    if (this.pending) clearTimeout(this.pending);
    this.pending = setTimeout(() => void this.flush(), 400);
  }

  async flush(): Promise<void> {
    if (this.pending) {
      clearTimeout(this.pending);
      this.pending = null;
    }
    if (!this.latest) return;
    const file: WindowStateFile = { version: 1, coach: this.latest };
    await writeJsonFile(this.filePath, file).catch(() => undefined);
  }
}
