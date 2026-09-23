import { DEFAULT_SETTINGS } from '../../shared/constants';
import type { PublicSettings } from '../../shared/domain';
import { publicSettingsSchema } from '../../shared/schemas';
import {
  CLOUD_MODELS,
  DEFAULT_PROVIDER_MODELS,
  LOCAL_STT_MODELS,
  PROVIDERS,
} from '../../shared/catalog';

/**
 * Settings migrations. Each entry upgrades from its index version to the
 * next; unknown/corrupt data falls back to defaults rather than crashing.
 * Data from a newer schema is kept when it validates (see loadSettingsData).
 */
type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;

export const CURRENT_SCHEMA_VERSION = 1;

const MIGRATIONS: Record<number, Migration> = {
  // 0 -> 1: pre-release settings had no schemaVersion; adopt defaults for
  // any missing field.
  0: (raw) => ({ ...raw, schemaVersion: 1 }),
};

export function migrateSettings(raw: unknown): PublicSettings {
  return loadSettingsData(raw).settings;
}

/**
 * How stored settings were interpreted:
 * - `ok`: current or older data, migrated (invalid data falls back to defaults);
 * - `newer-version`: written by a newer build but valid for this one; use it,
 *   but the caller must not write it back (it would drop the newer fields);
 * - `newer-invalid`: written by a newer build and not usable here; the caller
 *   should move the file aside before starting from defaults.
 */
export type SettingsLoadStatus = 'ok' | 'newer-version' | 'newer-invalid';

export function loadSettingsData(raw: unknown): {
  settings: PublicSettings;
  status: SettingsLoadStatus;
} {
  if (raw === null || typeof raw !== 'object')
    return { settings: { ...DEFAULT_SETTINGS }, status: 'ok' };
  let data = { ...(raw as Record<string, unknown>) };
  let version = typeof data.schemaVersion === 'number' ? data.schemaVersion : 0;
  if (version > CURRENT_SCHEMA_VERSION) {
    // Written by a newer app version. Keep what this build understands
    // (unknown fields drop) and let the store run read-only.
    const parsed = publicSettingsSchema.safeParse({ ...DEFAULT_SETTINGS, ...data });
    if (!parsed.success) return { settings: { ...DEFAULT_SETTINGS }, status: 'newer-invalid' };
    return {
      settings: normalizeProviders({ ...parsed.data, schemaVersion: CURRENT_SCHEMA_VERSION }),
      status: 'newer-version',
    };
  }
  while (version < CURRENT_SCHEMA_VERSION) {
    const migrate = MIGRATIONS[version];
    if (!migrate) return { settings: { ...DEFAULT_SETTINGS }, status: 'ok' };
    data = migrate(data);
    version = typeof data.schemaVersion === 'number' ? data.schemaVersion : version + 1;
  }
  const parsed = publicSettingsSchema.safeParse({ ...DEFAULT_SETTINGS, ...data });
  if (!parsed.success) return { settings: { ...DEFAULT_SETTINGS }, status: 'ok' };
  return { settings: normalizeProviders(parsed.data), status: 'ok' };
}

function normalizeProviders(settings: PublicSettings): PublicSettings {
  if (PROVIDERS[settings.sttProviderId]?.kind !== 'stt') settings.sttProviderId = 'local-whisper';
  if (PROVIDERS[settings.llmProviderId]?.kind !== 'llm') settings.llmProviderId = 'ollama';
  if (settings.sttProviderId === 'local-whisper') {
    if (!LOCAL_STT_MODELS.some((m) => m.id === settings.sttModelId))
      settings.sttModelId = DEFAULT_PROVIDER_MODELS['local-whisper'];
  } else settings.sttModelId = DEFAULT_PROVIDER_MODELS[settings.sttProviderId];
  if (settings.llmProviderId !== 'ollama') {
    if (
      settings.llmProviderId !== 'openrouter' ||
      (!settings.llmModelId.endsWith(':free') &&
        settings.llmModelId !== CLOUD_MODELS.openRouterDefaultModel)
    )
      settings.llmModelId = DEFAULT_PROVIDER_MODELS[settings.llmProviderId];
  }
  return settings;
}
