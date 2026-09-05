import React, { useState } from 'react';
import { PROVIDERS, PROVIDER_KEY_URLS } from '../../shared/catalog';
import type { ProviderProbe, PublicSettings } from '../../shared/domain';
import { errorMessage, setupPreset } from '../../shared/setup';

type CloudChoice = 'groq' | 'gemini' | 'openrouter' | 'cerebras';

/** Shared by first-run and Preferences so the fast setup also works after onboarding. */
export function CloudSetup({
  settings,
  onSettingsChanged,
  onNext,
}: {
  settings: PublicSettings;
  onSettingsChanged: () => Promise<void>;
  onNext?: () => void;
}): React.JSX.Element {
  const [provider, setProvider] = useState<CloudChoice>('groq');
  const [key, setKey] = useState('');
  const [probe, setProbe] = useState<ProviderProbe | null>(null);
  const [audioProbe, setAudioProbe] = useState<ProviderProbe | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const configured = settings.credentials[provider]?.configured;
  const hasCloudAudio = provider === 'groq' || provider === 'gemini';

  const apply = async () => {
    setSaving(true);
    setError('');
    setProbe(null);
    setAudioProbe(null);
    try {
      if (key.trim()) await window.cuedeck.setSecret(provider, key.trim());
      setKey('');
      const preset = setupPreset(provider);
      await window.cuedeck.updatePublicSettings(preset);
      await onSettingsChanged();
      const result = await window.cuedeck.testResponseProvider(provider);
      setProbe(result);
      if (hasCloudAudio) setAudioProbe(await window.cuedeck.probeProvider(preset.sttProviderId!));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="card" data-testid="cloud-setup">
      <h2>Free cloud setup</h2>
      <p>
        Groq uses one free account for audio and responses. No model downloads or Ollama needed.
      </p>
      <label className="field">
        <span>Cloud provider</span>
        <select
          aria-label="Cloud provider"
          value={provider}
          disabled={saving}
          onChange={(e) => {
            setProvider(e.target.value as CloudChoice);
            setKey('');
            setProbe(null);
            setAudioProbe(null);
            setError('');
          }}
        >
          <option value="groq">Groq — audio + responses (quickest setup)</option>
          <option value="gemini">Google Gemini — audio + responses</option>
          <option value="openrouter">OpenRouter — free responses; type a question</option>
          <option value="cerebras">Cerebras — trial responses; type a question</option>
        </select>
      </label>
      <p className="warn-banner">
        {PROVIDERS[provider].disclosure}{' '}
        {hasCloudAudio
          ? 'Recorded audio is also sent to this provider.'
          : 'Audio requires a separate local Whisper download; you can test typed questions immediately.'}
      </p>
      <p className="hint">
        Use a free account with billing disabled. Quotas can change; CueDeck cannot verify your
        account’s billing plan. The test sends only a short sample prompt.
      </p>
      <div className="row">
        <button onClick={() => void window.cuedeck.openExternal(PROVIDER_KEY_URLS[provider])}>
          Get {PROVIDERS[provider].displayName.split(' (')[0]} API key
        </button>
        <button
          className="small"
          onClick={() => void window.cuedeck.openExternal(PROVIDERS[provider].dataUseUrl!)}
        >
          Data-use policy
        </button>
      </div>
      <label className="field">
        <span>
          API key{' '}
          {configured ? '(saved — leave blank to reuse)' : '(stored encrypted on this computer)'}
        </span>
        <input
          type="password"
          value={key}
          disabled={saving}
          onChange={(e) => {
            setKey(e.target.value);
            setProbe(null);
          }}
          autoComplete="off"
          spellCheck={false}
          maxLength={4096}
        />
      </label>
      <div className="row">
        <button
          className="primary"
          onClick={() => void apply()}
          disabled={saving || (!key.trim() && !configured)}
        >
          {saving ? 'Testing a sample response…' : 'Save and test'}
        </button>
        {onNext && (
          <button
            onClick={onNext}
            disabled={
              saving ||
              probe?.status !== 'ready' ||
              (hasCloudAudio && audioProbe?.status !== 'ready')
            }
          >
            Continue
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
      {probe && (
        <p role="status">
          {probe.status === 'ready'
            ? '✓ Sample response received. Ready for typed questions.'
            : `Response check: ${probe.detail ?? probe.status}`}
        </p>
      )}
      {audioProbe && (
        <p role="status">
          {audioProbe.status === 'ready'
            ? '✓ Audio provider connected. Test system audio next.'
            : `Audio check: ${audioProbe.detail ?? audioProbe.status}`}
        </p>
      )}
    </section>
  );
}
