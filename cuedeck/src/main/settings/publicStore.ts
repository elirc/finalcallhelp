import path from 'node:path';
import type { PublicSettings } from '../../shared/domain';
import { publicSettingsPatchSchema } from '../../shared/schemas';
import { readJsonFile, writeJsonFile } from '../storage/jsonFile';
import { migrateSettings } from './migrations';
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

  constructor(userDataDir: string) {
    this.filePath = path.join(userDataDir, 'settings.json');
  }

  async load(): Promise<PublicSettings> {
    if (this.cache) return this.cache;
    this.loading ??= readJsonFile(this.filePath)
      .catch(() => null)
      .then((raw) => {
        this.cache = migrateSettings(raw);
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
        await writeJsonFile(this.filePath, next);
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
