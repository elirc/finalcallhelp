import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import { randomUUID } from 'node:crypto';
import type {
  AppCapabilities,
  OperationEvent,
  PreferencesSection,
  ProviderProbe,
  PublicSettings,
  ReadinessChange,
  SessionEvent,
} from '../../shared/domain';
import { LOCAL_STT_MODELS, PROVIDERS } from '../../shared/catalog';
import {
  captureArmSchema,
  diagnosticsExportSchema,
  historyDeleteSchema,
  historyListQuerySchema,
  modelsCancelDownloadSchema,
  modelsDownloadSchema,
  modelsListSchema,
  openExternalSchema,
  openPreferencesSchema,
  profileDeleteSchema,
  profileSaveSchema,
  providersProbeSchema,
  secretsRemoveSchema,
  secretsSetSchema,
  sessionCancelSchema,
  sessionRegenerateSchema,
  sessionSubmitMetaSchema,
  WAV_MAX_BYTES,
  WAV_MIN_BYTES,
} from '../../shared/schemas';
import { TIMEOUTS } from '../../shared/constants';
import { CoachError, toPublicError } from '../../shared/errors';
import type { Diagnostics } from '../diagnostics';
import { ProbeCache } from '../providers/probeCache';
import type { ProviderRegistry } from '../providers/registry';
import type { CaptureGrant } from '../security/captureGrant';
import { isTrustedSender, openExternalChecked } from '../security/windowSecurity';
import type { PublicSettingsStore } from '../settings/publicStore';
import type { SecretVault } from '../settings/secretVault';
import type { SessionCoordinator } from '../sessions/coordinator';
import type { HistoryStore } from '../storage/historyStore';
import type { ProfileStore } from '../storage/profileStore';
import type { SttWorkerManager } from '../workers/sttWorkerManager';

export interface AppServices {
  settings: PublicSettingsStore;
  secrets: SecretVault;
  history: HistoryStore;
  profiles: ProfileStore;
  registry: ProviderRegistry;
  coordinator: SessionCoordinator;
  captureGrant: CaptureGrant;
  diagnostics: Diagnostics;
  sttWorkers: SttWorkerManager;
  capabilities: () => AppCapabilities;
  broadcast: (
    channel: 'session:event' | 'operation:event' | 'settings:changed' | 'readiness:changed',
    payload: SessionEvent | OperationEvent | PublicSettings | ReadinessChange,
  ) => void;
  openPreferencesWindow: (section?: PreferencesSection) => void;
  /** Move the coach window to eye line (top-centre) and pin it on top. */
  dockEyeLine: () => Promise<void>;
  applyWindowSettings: () => Promise<void>;
}

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown> | unknown;

/**
 * Every privileged method validates the sender frame and its payload
 * before doing anything (spec §17.8-9). Errors cross the boundary as
 * structured PublicError objects, never stack traces.
 */
function secureHandle(channel: string, handler: Handler): void {
  ipcMain.handle(channel, async (event, ...args) => {
    if (
      !isTrustedSender(event.sender as WebContents) ||
      event.senderFrame !== event.sender.mainFrame
    ) {
      throw new Error('untrusted sender');
    }
    try {
      return await handler(event, ...args);
    } catch (err) {
      // Zod errors and internal errors all map to a structured public error.
      const publicErr = toPublicError(err);
      const wrapped = new Error(JSON.stringify(publicErr));
      wrapped.name = 'PublicError';
      throw wrapped;
    }
  });
}

const downloadOperations = new Map<string, AbortController>();
const probeCache = new ProbeCache<ProviderProbe>();

/**
 * Cache key covering every setting a probe result depends on, so an
 * unrelated settings change (font size, compact mode) reuses the cached
 * verdict while a model or server change re-probes.
 */
function probeKey(providerId: string, settings: PublicSettings): string {
  const meta = PROVIDERS[providerId];
  const configured = meta
    ? (settings.credentials[meta.credentialId ?? meta.id]?.configured ?? false)
    : false;
  return [providerId, settings.sttModelId, settings.ollamaBaseUrl, configured].join('|');
}

export function registerIpc(services: AppServices): void {
  secureHandle('app:getCapabilities', () => services.capabilities());

  secureHandle('app:openPreferences', (_event, raw) => {
    const options = openPreferencesSchema.parse(raw);
    services.openPreferencesWindow(options?.section);
    return true;
  });

  secureHandle('app:dockEyeLine', async () => {
    await services.dockEyeLine();
    return true;
  });

  secureHandle('app:openExternal', async (_event, raw) => {
    const { url } = openExternalSchema.parse(raw);
    return openExternalChecked(url);
  });

  // ---- settings -----------------------------------------------------------

  secureHandle('settings:getPublic', () => services.settings.get());

  secureHandle('settings:updatePublic', async (_event, patch) => {
    const updated = await services.settings.patch(patch);
    await services.applyWindowSettings();
    services.broadcast('settings:changed', updated);
    return updated;
  });

  // ---- secrets (write-only from the renderer) ------------------------------

  secureHandle('secrets:set', async (_event, raw) => {
    const { providerId, value } = secretsSetSchema.parse(raw);
    if (PROVIDERS[providerId]?.location !== 'cloud' || !value.trim())
      throw new CoachError('CREDENTIAL_MISSING');
    await services.secrets.set(providerId, value.trim());
    probeCache.invalidate(); // a replaced key must be re-verified, not served from cache
    services.broadcast(
      'settings:changed',
      await services.settings.setCredentialFlag(providerId, true),
    );
    services.broadcast('readiness:changed', { reason: 'credential-set' });
    return { hasCredential: true };
  });

  secureHandle('secrets:remove', async (_event, raw) => {
    const { providerId } = secretsRemoveSchema.parse(raw);
    await services.secrets.remove(providerId);
    probeCache.invalidate();
    services.broadcast(
      'settings:changed',
      await services.settings.setCredentialFlag(providerId, false),
    );
    services.broadcast('readiness:changed', { reason: 'credential-removed' });
    return { hasCredential: false };
  });

  // ---- providers and models -------------------------------------------------

  secureHandle('providers:list', () => services.registry.list());

  secureHandle('providers:probe', async (_event, raw) => {
    const { providerId, fresh } = providersProbeSchema.parse(raw);
    const provider = services.registry.getAny(providerId);
    const settings = await services.settings.get();
    return probeCache.get(
      probeKey(providerId, settings),
      () => provider.probe(AbortSignal.timeout(TIMEOUTS.probe)),
      fresh,
    );
  });

  secureHandle('providers:testResponse', async (_event, raw) => {
    const { providerId } = providersProbeSchema.parse(raw);
    const provider = services.registry.getLlm(providerId);
    const settings = await services.settings.get();
    if (settings.llmProviderId !== providerId)
      throw new CoachError('PROVIDER_UNAVAILABLE', 'Select this provider first.');
    const controller = new AbortController();
    const started = Date.now();
    try {
      for await (const delta of provider.generate({
        modelId: settings.llmModelId,
        system: 'Reply with exactly the word Ready.',
        user: 'Connection test.',
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(TIMEOUTS.llmFirstToken)]),
      })) {
        if (delta.text.trim())
          return { providerId, status: 'ready', latencyMs: Date.now() - started };
      }
      throw new CoachError('PROVIDER_UNAVAILABLE', 'The provider returned an empty sample.');
    } catch (err) {
      const error = toPublicError(err);
      return {
        providerId,
        status: error.code === 'PROVIDER_RATE_LIMITED' ? 'quota-limited' : 'unknown-failure',
        detail: error.message,
      };
    } finally {
      controller.abort();
    }
  });

  secureHandle('models:list', async (_event, raw) => {
    const { providerId } = modelsListSchema.parse(raw);
    const provider = services.registry.getAny(providerId);
    return provider.listModels(AbortSignal.timeout(TIMEOUTS.probe));
  });

  secureHandle('models:download', (_event, raw) => {
    const { modelId, operationId = randomUUID() } = modelsDownloadSchema.parse(raw);
    if (!LOCAL_STT_MODELS.some((model) => model.id === modelId))
      throw new CoachError('MODEL_NOT_INSTALLED', 'Choose a model from the local model catalog.');
    if (downloadOperations.size)
      throw new CoachError('PROVIDER_UNAVAILABLE', 'A model download is already running.');
    const controller = new AbortController();
    downloadOperations.set(operationId, controller);
    // Joins a load of the same model already in flight (e.g. a warmup)
    // instead of restarting it; cancelling detaches only this download and
    // kills the load only if nothing else is waiting on it.
    void services.sttWorkers
      .ensureModel(
        modelId,
        (p) =>
          services.broadcast('operation:event', {
            type: 'progress',
            operationId,
            stage: p.stage,
            value: p.value,
            detail: p.file,
          }),
        controller.signal,
        { allowDownload: true },
      )
      .then(() => {
        probeCache.invalidate('local-whisper');
        services.broadcast('readiness:changed', { reason: 'model-installed' });
        services.broadcast('operation:event', { type: 'complete', operationId });
      })
      .catch((err: unknown) => {
        services.broadcast('operation:event', {
          type: 'error',
          operationId,
          error: toPublicError(err),
        });
      })
      .finally(() => downloadOperations.delete(operationId));
    return { operationId };
  });

  secureHandle('models:cancelDownload', (_event, raw) => {
    const { operationId } = modelsCancelDownloadSchema.parse(raw);
    downloadOperations.get(operationId)?.abort();
    return true;
  });

  // ---- capture ---------------------------------------------------------------

  secureHandle('capture:arm', (_event, raw) => {
    const { sessionId } = captureArmSchema.parse(raw);
    // Warm the speech and response models while the clip is still being
    // recorded so neither cold start lands on the time-to-answer path.
    void services.coordinator.prewarm();
    return services.captureGrant.arm(sessionId);
  });

  // ---- session ---------------------------------------------------------------

  secureHandle('session:submit', (_event, rawMeta, wav) => {
    const meta = sessionSubmitMetaSchema.parse(rawMeta);
    if (!(wav instanceof ArrayBuffer) && !ArrayBuffer.isView(wav)) {
      throw new CoachError('UNKNOWN', 'audio payload must be binary');
    }
    const bytes =
      wav instanceof ArrayBuffer
        ? new Uint8Array(wav)
        : new Uint8Array(wav.buffer, wav.byteOffset, wav.byteLength);
    if (bytes.byteLength < WAV_MIN_BYTES) throw new CoachError('AUDIO_TOO_SHORT');
    if (bytes.byteLength > WAV_MAX_BYTES) throw new CoachError('AUDIO_TOO_LONG');
    void services.coordinator.submit(meta.sessionId, bytes, meta.options, meta.encodeMs);
    return { accepted: true };
  });

  secureHandle('session:regenerate', (_event, raw) => {
    const { sessionId, transcript, options } = sessionRegenerateSchema.parse(raw);
    void services.coordinator.regenerate(sessionId, transcript, options);
    return { accepted: true };
  });

  secureHandle('session:cancel', (_event, raw) => {
    const { sessionId } = sessionCancelSchema.parse(raw);
    services.coordinator.cancel(sessionId);
    services.captureGrant.disarm();
    return { cancelled: true };
  });

  // ---- history ----------------------------------------------------------------

  secureHandle('history:list', async (_event, raw) => {
    const { limit } = historyListQuerySchema.parse(raw ?? {});
    const settings = await services.settings.get();
    if (!settings.historyEnabled) return [];
    return services.history.list(limit, settings.historyRetentionDays);
  });

  secureHandle('history:delete', async (_event, raw) => {
    const { id } = historyDeleteSchema.parse(raw);
    await services.history.delete(id);
    return { deleted: true };
  });

  secureHandle('history:clear', async () => {
    await services.history.clear();
    return { cleared: true };
  });

  secureHandle('history:export', async () => {
    const settings = await services.settings.get();
    if (!settings.historyEnabled) return [];
    return services.history.list(Number.MAX_SAFE_INTEGER, settings.historyRetentionDays);
  });

  // ---- profiles ------------------------------------------------------------------

  secureHandle('profiles:list', () => services.profiles.list());

  secureHandle('profiles:save', async (_event, raw) => {
    const input = profileSaveSchema.parse(raw);
    return services.profiles.save(input);
  });

  secureHandle('profiles:delete', async (_event, raw) => {
    const { id } = profileDeleteSchema.parse(raw);
    await services.profiles.delete(id);
    const settings = await services.settings.get();
    if (settings.activeProfileId === id) {
      services.broadcast(
        'settings:changed',
        await services.settings.patch({ activeProfileId: undefined }),
      );
    }
    return { deleted: true };
  });

  // ---- diagnostics ----------------------------------------------------------------

  secureHandle('diagnostics:get', () => services.diagnostics.report());

  secureHandle('diagnostics:export', async (_event, raw) => {
    const options = diagnosticsExportSchema.parse(raw ?? {});
    let transcripts: string | undefined;
    let profile: string | undefined;
    if (options.includeTranscripts) {
      const settings = await services.settings.get();
      if (settings.historyEnabled) {
        const items = await services.history.list(20, settings.historyRetentionDays);
        transcripts = items.map((i) => `${i.createdAt}: ${i.transcript}`).join('\n');
      }
    }
    if (options.includeProfile) {
      const settings = await services.settings.get();
      const active = settings.activeProfileId
        ? await services.profiles.get(settings.activeProfileId)
        : null;
      profile = active ? `${active.name}\n${active.summary}\n${active.roleContext}` : undefined;
    }
    return services.diagnostics.exportText({ transcripts, profile });
  });
}
