import { describe, expect, it } from 'vitest';
import { CLOUD_MODELS, DEFAULT_PROVIDER_MODELS, PROVIDER_KEY_URLS } from '../../src/shared/catalog';
import { DEFAULT_SETTINGS } from '../../src/shared/constants';
import { responseReady, setupPreset } from '../../src/shared/setup';
import { isAllowedExternalUrl } from '../../src/main/security/urlPolicy';

describe('free testing setup', () => {
  it('configures both Groq stages with one credential owner and current models', () => {
    expect(setupPreset('groq')).toEqual({
      sttProviderId: 'groq-whisper',
      sttModelId: CLOUD_MODELS.groqSttModel,
      llmProviderId: 'groq',
      llmModelId: CLOUD_MODELS.groqLlmModel,
    });
  });
  it('clears stale cloud selections when switching back to local', () => {
    const settings = { ...DEFAULT_SETTINGS, ...setupPreset('groq'), ...setupPreset('local') };
    expect(settings.sttModelId).toBe(DEFAULT_PROVIDER_MODELS['local-whisper']);
    expect(settings.llmModelId).toBe('');
  });
  it('uses local audio for response-only cloud providers', () => {
    expect(setupPreset('openrouter').sttProviderId).toBe('local-whisper');
    expect(setupPreset('cerebras').sttProviderId).toBe('local-whisper');
  });
  it('requires the selected Ollama model, not just any installed model', () => {
    const settings = { ...DEFAULT_SETTINGS, llmModelId: 'missing' };
    const probe = {
      providerId: 'ollama',
      status: 'ready' as const,
      models: [{ id: 'installed', displayName: 'installed', providerId: 'ollama' }],
    };
    expect(responseReady(settings, probe)).toBe(false);
    expect(responseReady({ ...settings, llmModelId: 'installed' }, probe)).toBe(true);
    expect(responseReady({ ...settings, llmModelId: '' }, probe)).toBe(false);
  });
  it('does not reuse a probe from the previously selected provider', () => {
    expect(
      responseReady(
        { ...DEFAULT_SETTINGS, ...setupPreset('groq') },
        { providerId: 'gemini', status: 'ready' },
      ),
    ).toBe(false);
  });
  it('can actually open every key signup link', () => {
    for (const url of Object.values(PROVIDER_KEY_URLS))
      expect(isAllowedExternalUrl(url)).toBe(true);
  });
});
