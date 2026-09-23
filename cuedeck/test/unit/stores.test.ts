import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { migrateSettings } from '../../src/main/settings/migrations';
import { PublicSettingsStore } from '../../src/main/settings/publicStore';
import { SecretVault, type SafeStorageLike } from '../../src/main/settings/secretVault';
import { applyRetention, HistoryStore } from '../../src/main/storage/historyStore';
import { ProfileStore } from '../../src/main/storage/profileStore';
import { DEFAULT_SETTINGS } from '../../src/shared/constants';
import type { HistoryItem } from '../../src/shared/domain';
import { CLOUD_MODELS } from '../../src/shared/catalog';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'cuedeck-test-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const fakeSafeStorage: SafeStorageLike = {
  isEncryptionAvailable: () => true,
  encryptString: (plain) => Buffer.from(`enc:${plain}`, 'utf8'),
  decryptString: (buf) => buf.toString('utf8').replace(/^enc:/, ''),
};

describe('migrateSettings', () => {
  it('returns defaults for corrupt input', () => {
    expect(migrateSettings('garbage')).toEqual(DEFAULT_SETTINGS);
    expect(migrateSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(migrateSettings({ schemaVersion: 999 })).toEqual(DEFAULT_SETTINGS);
  });

  it('upgrades version 0 data preserving known fields', () => {
    const migrated = migrateSettings({ alwaysOnTop: true });
    expect(migrated.schemaVersion).toBe(1);
    expect(migrated.alwaysOnTop).toBe(true);
    expect(migrated.historyEnabled).toBe(false);
  });

  it('drops invalid field values back to defaults', () => {
    const migrated = migrateSettings({ schemaVersion: 1, fontScale: 99 });
    expect(migrated.fontScale).toBe(1);
  });

  it('fills fields added after the file was written (autoStopOnSilence)', () => {
    // A settings.json from a build that predates the field must load with
    // the default instead of being discarded wholesale.
    const migrated = migrateSettings({ schemaVersion: 1, alwaysOnTop: true });
    expect(migrated.autoStopOnSilence).toBe(true);
    expect(migrated.alwaysOnTop).toBe(true);
  });

  it('preserves a user-disabled auto-stop toggle across load', () => {
    const migrated = migrateSettings({ schemaVersion: 1, autoStopOnSilence: false });
    expect(migrated.autoStopOnSilence).toBe(false);
  });
});

describe('PublicSettingsStore', () => {
  it('preserves concurrent changes from both windows and the secret vault', async () => {
    const store = new PublicSettingsStore(dir);
    await Promise.all([
      store.patch({ alwaysOnTop: true }),
      store.patch({ fontScale: 1.3 }),
      store.setCredentialFlag('groq', true),
    ]);
    const saved = await new PublicSettingsStore(dir).get();
    expect(saved.alwaysOnTop).toBe(true);
    expect(saved.fontScale).toBe(1.3);
    expect(saved.credentials.groq.configured).toBe(true);
  });

  it('changes model defaults together with providers', async () => {
    const store = new PublicSettingsStore(dir);
    const saved = await store.patch({
      llmProviderId: 'groq',
      llmModelId: '',
      sttProviderId: 'groq-whisper',
    });
    expect(saved.llmModelId).toBe(CLOUD_MODELS.groqLlmModel);
    expect(saved.sttModelId).toBe(CLOUD_MODELS.groqSttModel);
  });

  it('rejects unsupported models and remote local-server addresses without poisoning writes', async () => {
    const store = new PublicSettingsStore(dir);
    await expect(
      store.patch({ llmProviderId: 'openrouter', llmModelId: 'paid/model' }),
    ).rejects.toThrow();
    await expect(store.patch({ sttModelId: '../../outside' })).rejects.toThrow();
    await expect(store.patch({ ollamaBaseUrl: 'https://example.com' })).rejects.toThrow();
    await store.patch({ alwaysOnTop: true });
    expect((await store.get()).alwaysOnTop).toBe(true);
  });

  it('migrates retired cloud model IDs without losing user preferences', () => {
    const saved = migrateSettings({
      ...DEFAULT_SETTINGS,
      llmProviderId: 'cerebras',
      llmModelId: 'llama3.1-8b',
      alwaysOnTop: true,
    });
    expect(saved.llmModelId).toBe(CLOUD_MODELS.cerebrasModel);
    expect(saved.alwaysOnTop).toBe(true);
  });
  it('persists patches and enforces the patch schema', async () => {
    const store = new PublicSettingsStore(dir);
    await store.patch({ alwaysOnTop: true });
    const reread = new PublicSettingsStore(dir);
    expect((await reread.get()).alwaysOnTop).toBe(true);
    await expect(store.patch({ credentials: {} })).rejects.toThrow();
  });

  it('tracks credential flags without values', async () => {
    const store = new PublicSettingsStore(dir);
    await store.setCredentialFlag('groq', true);
    expect((await store.get()).credentials.groq).toEqual({ configured: true });
    await store.setCredentialFlag('groq', false);
    expect((await store.get()).credentials.groq).toBeUndefined();
  });
});

describe('SecretVault', () => {
  it('preserves other account keys during concurrent saves and removal', async () => {
    const vault = new SecretVault(dir, fakeSafeStorage);
    await Promise.all([vault.set('groq', 'groq-fixture'), vault.set('gemini', 'gemini-fixture')]);
    expect(await vault.getForAdapter('groq')).toBe('groq-fixture');
    expect(await vault.getForAdapter('gemini')).toBe('gemini-fixture');
    await Promise.all([vault.remove('groq'), vault.set('cerebras', 'cerebras-fixture')]);
    expect(await vault.has('groq')).toBe(false);
    expect(await vault.getForAdapter('gemini')).toBe('gemini-fixture');
    expect(await vault.getForAdapter('cerebras')).toBe('cerebras-fixture');
  });

  it('stores only ciphertext on disk and returns values to adapters only', async () => {
    const vault = new SecretVault(dir, fakeSafeStorage);
    await vault.set('groq', 'gsk_super_secret_value');
    const raw = await readFile(path.join(dir, 'secrets.json'), 'utf8');
    expect(raw).not.toContain('gsk_super_secret_value');
    expect(await vault.has('groq')).toBe(true);
    expect(await vault.getForAdapter('groq')).toBe('gsk_super_secret_value');
    await vault.remove('groq');
    expect(await vault.has('groq')).toBe(false);
    expect(await vault.getForAdapter('groq')).toBeNull();
  });

  it('refuses to store when OS encryption is unavailable', async () => {
    const vault = new SecretVault(dir, { ...fakeSafeStorage, isEncryptionAvailable: () => false });
    await expect(vault.set('groq', 'value')).rejects.toThrow(/STORAGE_FAILED/);
  });

  it('settings file never receives the secret value', async () => {
    const settings = new PublicSettingsStore(dir);
    const vault = new SecretVault(dir, fakeSafeStorage);
    await vault.set('gemini', 'AIzaSecretValue123');
    await settings.setCredentialFlag('gemini', true);
    const settingsRaw = await readFile(path.join(dir, 'settings.json'), 'utf8');
    expect(settingsRaw).not.toContain('AIzaSecretValue123');
    expect(JSON.stringify(await settings.get())).not.toContain('AIzaSecretValue123');
  });
});

describe('HistoryStore', () => {
  const item = {
    transcript: 't',
    answer: 'a',
    sttProviderId: 'local-whisper',
    sttModelId: 'm',
    llmProviderId: 'ollama',
    llmModelId: 'q',
    answerMode: 'natural',
    timings: { encodeMs: 1, transcribeMs: 2, totalMs: 3 },
  };

  it('adds, lists, deletes, clears', async () => {
    const store = new HistoryStore(dir);
    await store.add(item, 7);
    await store.add({ ...item, transcript: 't2' }, 7);
    const items = await store.list(10, 7);
    expect(items).toHaveLength(2);
    expect(items[0].transcript).toBe('t2'); // newest first
    await store.delete(items[0].id);
    expect(await store.list(10, 7)).toHaveLength(1);
    await store.clear();
    expect(await store.list(10, 7)).toHaveLength(0);
  });

  it('removes expired history from disk when read, including session-only retention', async () => {
    const store = new HistoryStore(dir);
    await store.add(item, 30);
    const saved = (await store.list(10, 30))[0];
    await writeFile(
      path.join(dir, 'history.json'),
      JSON.stringify([
        saved,
        { ...saved, id: 'expired', createdAt: new Date(Date.now() - 4 * 86400000).toISOString() },
      ]),
    );
    expect(await store.list(10, 1)).toHaveLength(1);
    expect(JSON.parse(await readFile(path.join(dir, 'history.json'), 'utf8'))).toHaveLength(1);
    expect(await store.list(10, 0)).toEqual([]);
    expect(JSON.parse(await readFile(path.join(dir, 'history.json'), 'utf8'))).toEqual([]);
  });
});

describe('applyRetention', () => {
  const at = (daysAgo: number): HistoryItem => ({
    id: String(daysAgo),
    createdAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString(),
    transcript: '',
    answer: '',
    sttProviderId: '',
    sttModelId: '',
    llmProviderId: '',
    llmModelId: '',
    answerMode: 'natural',
    timings: { encodeMs: 0, transcribeMs: 0, totalMs: 0 },
  });

  it('keeps items inside the window and drops the rest', () => {
    const kept = applyRetention([at(0.5), at(6), at(8), at(40)], 7);
    expect(kept.map((i) => i.id)).toEqual(['0.5', '6']);
  });

  it('retention 0 keeps nothing', () => {
    expect(applyRetention([at(0.01)], 0)).toEqual([]);
  });

  it('drops items with unparseable dates', () => {
    const bad = { ...at(1), createdAt: 'not-a-date' };
    expect(applyRetention([bad], 30)).toEqual([]);
  });
});

describe('ProfileStore', () => {
  it('creates, updates, and deletes profiles', async () => {
    const store = new ProfileStore(dir);
    const created = await store.save({
      name: 'P1',
      summary: 's',
      roleContext: 'r',
      emphasisNotes: '',
    });
    expect(created.id).toBeTruthy();
    const updated = await store.save({ ...created, name: 'P1 renamed' });
    expect(updated.id).toBe(created.id);
    expect(updated.createdAt).toBe(created.createdAt);
    expect((await store.list())[0].name).toBe('P1 renamed');
    await store.delete(created.id);
    expect(await store.list()).toEqual([]);
  });
});

describe('store quarantine (unreadable files are kept, not overwritten)', () => {
  const corruptFiles = () => readdirSync(dir).filter((f) => /\.corrupt-.*\.json$/.test(f));

  const cases: {
    file: string;
    load: (report: (file: string, q: string) => void) => Promise<unknown>;
    empty: unknown;
  }[] = [
    {
      file: 'settings.json',
      load: (report) => new PublicSettingsStore(dir, report).get(),
      empty: DEFAULT_SETTINGS,
    },
    {
      file: 'history.json',
      load: (report) => new HistoryStore(dir, report).list(10, 7),
      empty: [],
    },
    { file: 'profiles.json', load: (report) => new ProfileStore(dir, report).list(), empty: [] },
    {
      file: 'secrets.json',
      load: (report) => new SecretVault(dir, fakeSafeStorage, report).listProviderIds(),
      empty: [],
    },
  ];

  for (const c of cases) {
    it(`moves a corrupt ${c.file} aside and starts empty`, async () => {
      await writeFile(path.join(dir, c.file), '{not json');
      const report = vi.fn();
      expect(await c.load(report)).toEqual(c.empty);
      const quarantined = corruptFiles();
      expect(quarantined).toHaveLength(1);
      expect(quarantined[0].startsWith(c.file.replace(/\.json$/, '.corrupt-'))).toBe(true);
      expect(await readFile(path.join(dir, quarantined[0]), 'utf8')).toBe('{not json');
      expect(report).toHaveBeenCalledTimes(1);
      expect(report).toHaveBeenCalledWith(c.file, path.join(dir, quarantined[0]));
    });
  }

  it('a normal first run creates no quarantine file and reports nothing', async () => {
    const report = vi.fn();
    const settings = new PublicSettingsStore(dir, report);
    await settings.get();
    await settings.patch({ alwaysOnTop: true });
    await new HistoryStore(dir, report).list(10, 7);
    await new ProfileStore(dir, report).list();
    const vault = new SecretVault(dir, fakeSafeStorage, report);
    await vault.set('groq', 'k');
    await vault.has('groq');
    expect(corruptFiles()).toEqual([]);
    expect(report).not.toHaveBeenCalled();
  });

  it('keeps newer-version settings and never writes over them', async () => {
    const file = path.join(dir, 'settings.json');
    const original = JSON.stringify({
      ...DEFAULT_SETTINGS,
      schemaVersion: 99,
      alwaysOnTop: true,
      fontScale: 1.3,
      someFutureField: 'kept on disk',
    });
    await writeFile(file, original);
    const report = vi.fn();
    const store = new PublicSettingsStore(dir, report);
    const loaded = await store.get();
    expect(loaded.alwaysOnTop).toBe(true);
    expect(loaded.fontScale).toBe(1.3);
    expect(store.readOnlyReason).toBe('newer-version');
    const patched = await store.patch({ compactMode: true });
    expect(patched.compactMode).toBe(true);
    expect((await store.get()).compactMode).toBe(true);
    await store.setCredentialFlag('groq', true);
    expect(await readFile(file, 'utf8')).toBe(original);
    expect(corruptFiles()).toEqual([]);
    expect(report).not.toHaveBeenCalled();
  });

  it('quarantines newer-version settings that do not validate', async () => {
    await writeFile(
      path.join(dir, 'settings.json'),
      JSON.stringify({ schemaVersion: 99, fontScale: 'huge' }),
    );
    const report = vi.fn();
    const store = new PublicSettingsStore(dir, report);
    expect(await store.get()).toEqual(DEFAULT_SETTINGS);
    expect(store.readOnlyReason).toBeNull();
    expect(corruptFiles()).toHaveLength(1);
    expect(report).toHaveBeenCalledTimes(1);
  });
});

describe('SecretVault.listProviderIds', () => {
  it('lists the ids of stored credentials only', async () => {
    const vault = new SecretVault(dir, fakeSafeStorage);
    expect(await vault.listProviderIds()).toEqual([]);
    await vault.set('groq', 'a');
    await vault.set('gemini', 'b');
    expect((await vault.listProviderIds()).sort()).toEqual(['gemini', 'groq']);
    await vault.remove('groq');
    expect(await vault.listProviderIds()).toEqual(['gemini']);
  });
});
