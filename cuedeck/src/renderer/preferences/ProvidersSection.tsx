import React, { useCallback, useEffect, useState } from 'react';
import { DEFAULT_PROVIDER_MODELS } from '../../shared/catalog';
import type { ModelSummary, ProviderMeta, ProviderProbe } from '../../shared/domain';
import { setupPreset } from '../../shared/setup';
import { CloudSetup } from '../routes/CloudSetup';
import { useSettingsUpdate } from '../state/useSettingsUpdate';
import { LocalModelPicker } from './LocalModelPicker';
import type { SectionProps } from './types';

export function ProvidersSection({ settings, onSettingsChanged }: SectionProps): React.JSX.Element {
  const [providers, setProviders] = useState<ProviderMeta[]>([]);
  const [probes, setProbes] = useState<Record<string, ProviderProbe>>({});
  const [models, setModels] = useState<Record<string, ModelSummary[]>>({});
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({});
  const [ollamaUrl, setOllamaUrl] = useState(settings.ollamaBaseUrl);
  const update = useSettingsUpdate(onSettingsChanged);

  useEffect(() => {
    void window.cuedeck.listProviders().then(setProviders);
  }, []);

  useEffect(() => {
    void window.cuedeck
      .listModels(settings.llmProviderId)
      .then((list) => {
        setModels((current) => ({ ...current, [settings.llmProviderId]: list }));
      })
      .catch(() => undefined);
  }, [settings.llmProviderId, settings.ollamaBaseUrl]);

  // Explicit "Test" buttons bypass the probe cache: the user wants a live answer.
  const probe = async (providerId: string) => {
    const result = await window.cuedeck
      .probeProvider(providerId, true)
      .catch((err: { message?: string }): ProviderProbe => ({
        providerId,
        status: 'unknown-failure',
        detail: err?.message,
      }));
    setProbes((p) => ({ ...p, [providerId]: result }));
    if (result.models) setModels((m) => ({ ...m, [providerId]: result.models as ModelSummary[] }));
    return result;
  };

  const loadModels = useCallback(async (providerId: string) => {
    const list = await window.cuedeck.listModels(providerId).catch(() => []);
    setModels((m) => ({ ...m, [providerId]: list }));
  }, []);
  const loadLocalModels = useCallback(() => void loadModels('local-whisper'), [loadModels]);

  const sttProviders = providers.filter((p) => p.kind === 'stt');
  const llmProviders = providers.filter((p) => p.kind === 'llm');
  // One key section per cloud account, derived from provider metadata so a
  // newly registered provider shows up without touching this component.
  const cloudProviders = [
    ...new Set(providers.filter((p) => p.location === 'cloud').map((p) => p.credentialId ?? p.id)),
  ];

  const providerStatus = (id: string) => {
    const p = probes[id];
    if (!p) return null;
    return (
      <span role="status">
        {p.status === 'ready' ? '✓ ready' : `✗ ${p.status}`}
        {p.detail ? ` — ${p.detail}` : ''}
        {p.latencyMs !== undefined ? ` (${p.latencyMs} ms)` : ''}
      </span>
    );
  };

  const optionLabel = (p: ProviderMeta) =>
    `${p.displayName}${p.freePolicy === 'always-free-local' ? ' — always free' : ' — free tier, limits may change'}`;
  const needsKey = (p: ProviderMeta) =>
    p.location === 'cloud' && !settings.credentials[p.credentialId ?? p.id]?.configured;

  return (
    <>
      <h1>Providers</h1>
      <CloudSetup settings={settings} onSettingsChanged={onSettingsChanged} />
      <section className="card">
        <h2>Processing summary</h2>
        <p>
          Speech-to-text: <strong>{settings.sttProviderId}</strong> (
          {sttProviders.find((p) => p.id === settings.sttProviderId)?.location ?? '?'}) • Responses:{' '}
          <strong>{settings.llmProviderId}</strong> (
          {llmProviders.find((p) => p.id === settings.llmProviderId)?.location ?? '?'})
        </p>
        <p>
          When a cloud provider is selected, it receives: the current audio clip (STT) or
          transcript, your active profile (background, role context, tech stack), and session notes.
          Nothing else — no history, no other profiles, no screen content.
        </p>
        <button className="small" onClick={() => void update(setupPreset('local'))}>
          Switch everything to local-only
        </button>
      </section>

      <section className="card">
        <h2>Speech-to-text</h2>
        <label className="field">
          <span>Provider</span>
          <select
            value={settings.sttProviderId}
            onChange={(e) =>
              void update({
                sttProviderId: e.target.value,
                sttModelId: DEFAULT_PROVIDER_MODELS[e.target.value],
              })
            }
          >
            {sttProviders.map((p) => (
              <option key={p.id} value={p.id} disabled={needsKey(p)}>
                {optionLabel(p)}
              </option>
            ))}
          </select>
        </label>
        {settings.sttProviderId === 'local-whisper' && (
          <LocalModelPicker
            settings={settings}
            models={models['local-whisper']}
            onLoad={loadLocalModels}
            onSettingsChanged={onSettingsChanged}
          />
        )}
        <div className="row">
          <button className="small" onClick={() => void probe(settings.sttProviderId)}>
            Test speech-to-text
          </button>
          {providerStatus(settings.sttProviderId)}
        </div>
      </section>

      <section className="card">
        <h2>Response model</h2>
        <label className="field">
          <span>Provider</span>
          <select
            value={settings.llmProviderId}
            onChange={(e) =>
              void update({
                llmProviderId: e.target.value,
                llmModelId: DEFAULT_PROVIDER_MODELS[e.target.value],
              })
            }
          >
            {llmProviders.map((p) => (
              <option key={p.id} value={p.id} disabled={needsKey(p)}>
                {optionLabel(p)}
              </option>
            ))}
          </select>
        </label>
        <div className="row">
          <button
            className="small"
            onClick={() =>
              void probe(settings.llmProviderId).then(() => loadModels(settings.llmProviderId))
            }
          >
            Check &amp; list models
          </button>
          {providerStatus(settings.llmProviderId)}
        </div>
        {(models[settings.llmProviderId] ?? []).length > 0 && (
          <label className="field">
            <span>Model</span>
            <select
              value={settings.llmModelId}
              onChange={(e) => void update({ llmModelId: e.target.value })}
            >
              <option value="">Choose a model…</option>
              {(models[settings.llmProviderId] ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName}
                </option>
              ))}
            </select>
          </label>
        )}
        {settings.llmProviderId === 'ollama' && (
          <details>
            <summary>Advanced: Ollama server address</summary>
            <label className="field">
              <span>Base URL (default http://127.0.0.1:11434)</span>
              <input value={ollamaUrl} onChange={(e) => setOllamaUrl(e.target.value)} />
            </label>
            <p className="hint">
              Use a loopback address (localhost, 127.0.0.1, or ::1). Remote Ollama servers are not
              supported.
            </p>
            <button className="small" onClick={() => void update({ ollamaBaseUrl: ollamaUrl })}>
              Save server address
            </button>
          </details>
        )}
      </section>

      <section className="card">
        <h2>Cloud API keys (optional)</h2>
        <p>
          Keys are encrypted with Windows account protection, never shown again after saving, and
          removable at any time. Local mode needs no key.
        </p>
        {cloudProviders.map((id) => {
          const meta =
            providers.find((p) => p.id === id) ??
            providers.find((p) => (p.credentialId ?? p.id) === id);
          const configured = settings.credentials[id]?.configured ?? false;
          return (
            <div key={id} className="field key-row">
              <span>
                <strong>{meta?.displayName ?? id}</strong> —{' '}
                {configured ? 'key saved' : 'no key saved'}
                {meta?.dataUseUrl && (
                  <>
                    {' '}
                    <a
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        void window.cuedeck.openExternal(meta.dataUseUrl as string);
                      }}
                    >
                      data-use policy
                    </a>
                  </>
                )}
              </span>
              {meta?.disclosure && (
                <span style={{ color: 'var(--warning)' }}>{meta.disclosure}</span>
              )}
              <div className="row">
                <input
                  type="password"
                  placeholder={configured ? 'Enter a new key to replace' : 'Paste API key'}
                  autoComplete="off"
                  value={keyInputs[id] ?? ''}
                  onChange={(e) => setKeyInputs((k) => ({ ...k, [id]: e.target.value }))}
                  style={{ maxWidth: 320 }}
                />
                <button
                  className="small"
                  disabled={!(keyInputs[id] ?? '').trim()}
                  onClick={async () => {
                    await window.cuedeck.setSecret(id, (keyInputs[id] ?? '').trim());
                    setKeyInputs((k) => ({ ...k, [id]: '' }));
                    await onSettingsChanged();
                    void probe(id);
                  }}
                >
                  {configured ? 'Replace' : 'Save'}
                </button>
                {configured && (
                  <button
                    className="small danger"
                    onClick={async () => {
                      await window.cuedeck.removeSecret(id);
                      await onSettingsChanged();
                    }}
                  >
                    Remove
                  </button>
                )}
                <button className="small" onClick={() => void probe(id)} disabled={!configured}>
                  Test
                </button>
                {providerStatus(id)}
              </div>
            </div>
          );
        })}
      </section>
    </>
  );
}
