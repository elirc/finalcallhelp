import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WindowStateStore } from '../../src/main/windows/windowState';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'cuedeck-winstate-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('WindowStateStore', () => {
  it('returns null before anything was remembered and writes nothing on an empty flush', async () => {
    const store = new WindowStateStore(dir);
    expect(await store.loadCoachBounds()).toBeNull();
    await store.flush();
    expect(await new WindowStateStore(dir).loadCoachBounds()).toBeNull();
  });

  it('round-trips the last remembered bounds through a fresh store', async () => {
    const store = new WindowStateStore(dir);
    store.rememberCoachBounds({ x: 10, y: 20, width: 800, height: 500 });
    store.rememberCoachBounds({ x: 30, y: 40, width: 820, height: 520 }); // debounced: last wins
    await store.flush();
    expect(await new WindowStateStore(dir).loadCoachBounds()).toEqual({
      x: 30,
      y: 40,
      width: 820,
      height: 520,
    });
  });

  it('writes on its own after the debounce delay', async () => {
    const store = new WindowStateStore(dir);
    store.rememberCoachBounds({ x: 1, y: 2, width: 700, height: 400 });
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(await new WindowStateStore(dir).loadCoachBounds()).toEqual({
      x: 1,
      y: 2,
      width: 700,
      height: 400,
    });
  });

  it('ignores malformed, wrong-version, or too-small saved state', async () => {
    const file = path.join(dir, 'window-state.json');
    writeFileSync(file, 'not json');
    expect(await new WindowStateStore(dir).loadCoachBounds()).toBeNull();
    writeFileSync(
      file,
      JSON.stringify({ version: 2, coach: { x: 0, y: 0, width: 800, height: 500 } }),
    );
    expect(await new WindowStateStore(dir).loadCoachBounds()).toBeNull();
    writeFileSync(file, JSON.stringify({ version: 1, coach: { x: 0, y: 0, width: 5, height: 5 } }));
    expect(await new WindowStateStore(dir).loadCoachBounds()).toBeNull();
    writeFileSync(file, JSON.stringify({ version: 1, coach: null }));
    expect(await new WindowStateStore(dir).loadCoachBounds()).toBeNull();
  });

  it('flushSync writes the bounds before returning and cancels the debounced write', async () => {
    const store = new WindowStateStore(dir);
    const file = path.join(dir, 'window-state.json');
    store.rememberCoachBounds({ x: 5, y: 6, width: 710, height: 410 });
    store.flushSync();
    expect(JSON.parse(readFileSync(file, 'utf8')).coach).toEqual({
      x: 5,
      y: 6,
      width: 710,
      height: 410,
    });
    // Replace the file with a marker: a second (debounced) write would overwrite it.
    writeFileSync(file, 'marker');
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(readFileSync(file, 'utf8')).toBe('marker');
    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('flushSync with nothing remembered writes nothing', () => {
    new WindowStateStore(dir).flushSync();
    expect(readdirSync(dir)).toEqual([]);
  });
});
