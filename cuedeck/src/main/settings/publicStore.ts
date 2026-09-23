import path from 'node:path';
import type { PublicSettings } from '../../shared/domain';
import { publicSettingsPatchSchema } from '../../shared/schemas';
import { quarantineFile, readJsonFile, writeJsonFile } from '../storage/jsonFile';
import { loadSettingsData } from './migrations';
import { DEFAULT_PROVIDER_MODELS } from '../../shared/catalog';
import { validateProviderSettings } from './providerSettings';

/**
 * Public (non-secret) settings. Credential *values* never live here — only
 * `configured` flags maintained by the secret vault.
 */
export class PublicSettingsStore {
  private readonly filePath: string;
  private cache: PublicSettings | null = null;
  private loading: Promise<PublicSettings> | null = null;
  private writeChain: Promise<unknown> = Promise.resolve();
  private readOnly: 'newer-version' | null = null;

  constructor(
    userDataDir: string,
    private readonly reportCorrupt?: (file: string, quarantinePath: string) => void,
  ) {
    this.filePath = path.join(userDataDir, 'settings.json');
  }

  /**
   * Set when settings.json was written by a newer CueDeck: changes still
   * apply in memory for this run but are never written back, so the newer
   * build's file (and any fields this build does not know) survives.
   */
  get readOnlyReason(): 'newer-version' | null {
    return this.readOnly;
  }

  async load(): Promise<PublicSettings> {
    if (this.cache) return this.cache;
    const onCorrupt = (q: string) => this.reportCorrupt?.('settings.json', q);
    this.loading ??= readJsonFile(this.filePath, { onCorrupt })
      .catch(() => null)
      .then(async (raw) => {
        const { settings, status } = loadSettingsData(raw);
        if (status === 'newer-version') this.readOnly = 'newer-version';
        if (status === 'newer-invalid')
          await quarantineFile(this.filePath, onCorrupt).catch(() => undefined);
        this.cache = settings;
        return this.cache;
      });
    return this.loading;
  }

  async get(): Promise<PublicSettings> {
    return this.load();
  }

  async patch(rawPatch: unknown): Promise<PublicSettings> {
    const patch = publicSettingsPatchSchema.parse(rawPatch);
    return this.mutate((current) => {
      const next: PublicSettings = { ...current, ...patch };
      if (patch.sttProviderId && patch.sttProviderId !== current.sttProviderId && !patch.sttModelId)
        next.sttModelId = DEFAULT_PROVIDER_MODELS[patch.sttProviderId];
      if (patch.llmProviderId && patch.llmProviderId !== current.llmProviderId && !patch.llmModelId)
        next.llmModelId = DEFAULT_PROVIDER_MODELS[patch.llmProviderId];
      validateProviderSettings(next);
      return next;
    });
  }

  /** Internal-only writes (e.g. credential flags); bypasses the renderer patch schema. */
  async replace(next: PublicSettings): Promise<PublicSettings> {
    return this.mutate(() => next);
  }

  /** Serialize read/modify/write, including cache updates, across both windows. */
  private mutate(update: (current: PublicSettings) => PublicSettings): Promise<PublicSettings> {
    const write = this.writeChain
      .catch(() => undefined)
      .then(async () => {
        const next = update(await this.load());
        if (!this.readOnly) await writeJsonFile(this.filePath, next);
        this.cache = next;
        return next;
      });
    this.writeChain = write;
    return write;
  }

  async setCredentialFlag(providerId: string, configured: boolean): Promise<PublicSettings> {
    return this.mutate((current) => {
      const credentials = { ...current.credentials };
      if (configured) credentials[providerId] = { configured: true };
      else delete credentials[providerId];
      return { ...current, credentials };
    });
  }
}
