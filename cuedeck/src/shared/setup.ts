import { DEFAULT_PROVIDER_MODELS } from './catalog';
import type { ProviderProbe, PublicSettings } from './domain';

export type SetupPreset = 'demo' | 'local' | 'groq' | 'gemini' | 'openrouter' | 'cerebras';

/** Change both provider/model pairs together so old selections cannot leak across modes. */
export function setupPreset(mode: SetupPreset): Partial<PublicSettings> {
  const sttProviderId =
    mode === 'groq' ? 'groq-whisper' : mode === 'gemini' ? 'gemini-audio' : 'local-whisper';
  const llmProviderId = mode === 'local' ? 'ollama' : mode;
  return {
    sttProviderId,
    sttModelId: DEFAULT_PROVIDER_MODELS[sttProviderId],
    llmProviderId,
    llmModelId: DEFAULT_PROVIDER_MODELS[llmProviderId],
  };
}

export function responseReady(settings: PublicSettings, probe: ProviderProbe | null): boolean {
  if (
    !settings.llmModelId ||
    probe?.providerId !== settings.llmProviderId ||
    probe.status !== 'ready'
  )
    return false;
  return (
    settings.llmProviderId !== 'ollama' || !!probe.models?.some((m) => m.id === settings.llmModelId)
  );
}

export function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string')
    return error.message;
  return 'The request failed. Please try again.';
}
