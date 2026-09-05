import {
  CLOUD_MODELS,
  DEFAULT_PROVIDER_MODELS,
  LOCAL_STT_MODELS,
  PROVIDERS,
} from '../../shared/catalog';
import type { PublicSettings } from '../../shared/domain';
import { CoachError } from '../../shared/errors';
import { isLoopbackHost } from '../security/http';

export function validateProviderSettings(settings: PublicSettings): void {
  if (
    PROVIDERS[settings.sttProviderId]?.kind !== 'stt' ||
    PROVIDERS[settings.llmProviderId]?.kind !== 'llm'
  ) {
    throw new CoachError('PROVIDER_UNAVAILABLE', 'Choose a supported provider.');
  }
  if (
    settings.sttProviderId === 'local-whisper'
      ? !LOCAL_STT_MODELS.some((m) => m.id === settings.sttModelId)
      : settings.sttModelId !== DEFAULT_PROVIDER_MODELS[settings.sttProviderId]
  ) {
    throw new CoachError('MODEL_NOT_INSTALLED', 'Choose a supported speech model.');
  }
  if (settings.llmModelId && settings.llmProviderId !== 'ollama') {
    const allowed =
      settings.llmProviderId === 'openrouter'
        ? settings.llmModelId === CLOUD_MODELS.openRouterDefaultModel ||
          settings.llmModelId.endsWith(':free')
        : settings.llmModelId === DEFAULT_PROVIDER_MODELS[settings.llmProviderId];
    if (!allowed)
      throw new CoachError('PROVIDER_UNAVAILABLE', 'Choose a supported free-tier model.');
  }
  const url = new URL(settings.ollamaBaseUrl);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    !isLoopbackHost(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new CoachError(
      'LOCAL_PROVIDER_UNREACHABLE',
      'Ollama must use a local HTTP address without credentials, query, or fragment.',
    );
  }
}
