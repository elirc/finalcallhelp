import React, { useEffect, useRef, useState } from 'react';
import type { CallType } from '../../shared/callTypes';
import type { ModelSummary, ProviderProbe, PublicSettings } from '../../shared/domain';
import { ClipRecorder } from '../audio/recorder';
import { LOCAL_STT_MODELS } from '../../shared/catalog';
import { errorMessage, setupPreset } from '../../shared/setup';
import { CallTypeFields } from '../profiles/ProfileFields';
import { CloudSetup } from './CloudSetup';

interface Props {
  settings: PublicSettings;
  onSettingsChanged: () => Promise<void>;
}

type Step = 'consent' | 'mode' | 'local-setup' | 'cloud-setup' | 'audio-test' | 'profile';

const STEP_NUMBER: Record<Step, number> = {
  consent: 1,
  mode: 2,
  'local-setup': 3,
  'cloud-setup': 3,
  'audio-test': 4,
  profile: 5,
};
const STEP_COUNT = 5;

/**
 * First-run flow (spec §8.5). The recommended local path never shows an
 * API-key form; the consent acknowledgement is required before anything else.
 */
export function Onboarding({ settings, onSettingsChanged }: Props): React.JSX.Element {
  const [step, setStep] = useState<Step>(settings.consentAcknowledgedAt ? 'mode' : 'consent');
  const [consentChecked, setConsentChecked] = useState(false);

  return (
    <div className="app-shell">
      <div className="onboarding" data-testid={`onboarding-${step}`}>
        <p className="step-indicator" data-testid="onboarding-step">
          Step {STEP_NUMBER[step]} of {STEP_COUNT}
        </p>
        {step !== 'consent' && step !== 'mode' && (
          <button className="small" onClick={() => setStep('mode')}>
            Back to setup options
          </button>
        )}
        {step === 'consent' && (
          <>
            <h1>Welcome to CueDeck</h1>
            <p>
              CueDeck records short clips of this computer&apos;s audio — after you press the Listen
              control — transcribes them, and drafts a response you could say next. It is built for
              mock interviews, rehearsal, accessibility support, and calls where recording and AI
              assistance are disclosed and permitted.
            </p>
            <p className="warn-banner">
              A visible recording indicator is always shown while capture is active. CueDeck has no
              hidden-recording or screen-share-concealment features, and will never add them.
            </p>
            <label className="row">
              <input
                type="checkbox"
                style={{ width: 'auto' }}
                checked={consentChecked}
                onChange={(e) => setConsentChecked(e.target.checked)}
                data-testid="consent-checkbox"
              />
              <span>
                I am responsible for obtaining participant consent and following the rules that
                apply to my calls, interviews, and jurisdiction.
              </span>
            </label>
            <button
              className="primary"
              disabled={!consentChecked}
              data-testid="consent-continue"
              onClick={async () => {
                await window.cuedeck.updatePublicSettings({
                  consentAcknowledgedAt: new Date().toISOString(),
                });
                await onSettingsChanged();
                setStep('mode');
              }}
            >
              I understand — continue
            </button>
          </>
        )}

        {step === 'mode' && (
          <ModeStep
            onLocal={async () => {
              await window.cuedeck.updatePublicSettings(setupPreset('local'));
              await onSettingsChanged();
              setStep('local-setup');
            }}
            onCloud={() => setStep('cloud-setup')}
            onDemo={async () => {
              await window.cuedeck.updatePublicSettings({
                ...setupPreset('demo'),
                onboardingComplete: true,
              });
              await onSettingsChanged();
            }}
          />
        )}

        {step === 'local-setup' && (
          <LocalSetupStep
            settings={settings}
            onSettingsChanged={onSettingsChanged}
            onNext={() => setStep('audio-test')}
          />
        )}

        {step === 'cloud-setup' && (
          <CloudSetup
            settings={settings}
            onSettingsChanged={onSettingsChanged}
            onNext={() => setStep('audio-test')}
          />
        )}

        {step === 'audio-test' && <AudioTestStep onNext={() => setStep('profile')} />}

        {step === 'profile' && (
          <ProfileStep
            onNext={async () => {
              await window.cuedeck.updatePublicSettings({ onboardingComplete: true });
              await onSettingsChanged();
            }}
            onSettingsChanged={onSettingsChanged}
          />
        )}
      </div>
    </div>
  );
}

function ModeStep({
  onLocal,
  onCloud,
  onDemo,
}: {
  onLocal: () => Promise<void>;
  onCloud: () => void;
  onDemo: () => Promise<void>;
}): React.JSX.Element {
  return (
    <>
      <h1>Start testing CueDeck</h1>
      <p>Choose real AI with a free account, or try the interface now with sample responses.</p>
      <section className="card">
        <h2>Cloud free tier: quickest way to real AI</h2>
        <p>
          Audio and transcripts are sent to a provider you choose (Groq, Google Gemini, or
          OpenRouter) using their free tiers. Quotas are limited and may change, and providers may
          use free-tier content per their policies. You can switch to local-only at any time.
        </p>
        <button className="primary" onClick={onCloud} data-testid="choose-cloud">
          Use cloud free tier
        </button>
      </section>
      <section className="card">
        <h2>Demo: no key, no downloads</h2>
        <p>
          Try practice questions, streaming, copy, and cancellation with a fixed sample response.
          Demo does not use AI or record audio.
        </p>
        <button onClick={() => void onDemo()} data-testid="choose-demo">
          Try the demo
        </button>
      </section>
      <section className="card">
        <h2>Local: always free, private</h2>
        <p>
          Transcription and responses run entirely on this computer using a downloaded Whisper model
          and Ollama. Nothing is sent to any server. No account, key, or payment.
        </p>
        <button className="primary" onClick={() => void onLocal()} data-testid="choose-local">
          Use local mode
        </button>
      </section>
    </>
  );
}

function LocalSetupStep({
  settings,
  onSettingsChanged,
  onNext,
}: {
  settings: PublicSettings;
  onSettingsChanged: () => Promise<void>;
  onNext: () => void;
}): React.JSX.Element {
  const [sttProbe, setSttProbe] = useState<ProviderProbe | null>(null);
  const [ollamaProbe, setOllamaProbe] = useState<ProviderProbe | null>(null);
  const [downloadState, setDownloadState] = useState<{
    operationId: string;
    value?: number;
    detail?: string;
  } | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  // `fresh` bypasses the main-process probe cache: an explicit re-check must
  // not repeat a cached failure.
  const probeAll = async (fresh = false) => {
    const [stt, ollama] = await Promise.all([
      window.cuedeck.probeProvider('local-whisper', fresh),
      window.cuedeck.probeProvider('ollama', fresh),
    ]);
    setSttProbe(stt);
    setOllamaProbe(ollama);
  };

  useEffect(() => {
    void probeAll();
  }, [settings.sttModelId]);

  useEffect(() => {
    return window.cuedeck.onOperationEvent((event) => {
      setDownloadState((current) => {
        if (!current || event.operationId !== current.operationId) return current;
        if (event.type === 'progress')
          return { ...current, value: event.value, detail: event.detail };
        if (event.type === 'complete') {
          void probeAll(true);
          return null;
        }
        if (event.type === 'error') {
          setDownloadError(event.error.message);
          return null;
        }
        return current;
      });
    });
  }, []);

  const startDownload = async () => {
    setDownloadError(null);
    const operationId = crypto.randomUUID();
    setDownloadState({ operationId });
    try {
      await window.cuedeck.downloadModel(settings.sttModelId, operationId);
    } catch (err) {
      setDownloadState(null);
      setDownloadError(errorMessage(err));
    }
  };

  const model = sttProbe?.models?.find((m: ModelSummary) => m.id === settings.sttModelId);
  const sttReady = sttProbe?.status === 'ready';
  const ollamaReady = ollamaProbe?.status === 'ready';

  useEffect(() => {
    const installed = ollamaProbe?.models ?? [];
    if (installed.length && !settings.llmModelId) {
      void window.cuedeck
        .updatePublicSettings({ llmModelId: installed[0].id })
        .then(onSettingsChanged);
    }
  }, [ollamaProbe, settings.llmModelId]);

  return (
    <>
      <h1>Set up local mode</h1>
      <section className="card">
        <h2>1. Speech-to-text model</h2>
        <label className="field">
          <span>Whisper model</span>
          <select
            disabled={!!downloadState}
            value={settings.sttModelId}
            onChange={async (e) => {
              setSttProbe(null);
              await window.cuedeck.updatePublicSettings({ sttModelId: e.target.value });
              await onSettingsChanged();
            }}
          >
            {LOCAL_STT_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName}
              </option>
            ))}
          </select>
        </label>
        <p>
          {settings.sttModelId} — about{' '}
          {(model?.sizeBytes ? model.sizeBytes / 1e6 : 200).toFixed(0)} MB,{' '}
          {model?.license ?? 'MIT license'}. Downloaded once to this computer&apos;s app data
          folder.
        </p>
        {sttReady ? (
          <p role="status">✓ Model installed and ready.</p>
        ) : downloadState ? (
          <>
            <div className="progress-bar" aria-label="model download progress">
              <div style={{ width: `${downloadState.value ?? 5}%` }} />
            </div>
            <p role="status">
              Downloading {downloadState.detail ?? '…'}{' '}
              {downloadState.value ? `${downloadState.value.toFixed(0)}%` : ''}
            </p>
            <button onClick={() => void window.cuedeck.cancelDownload(downloadState.operationId)}>
              Cancel download
            </button>
          </>
        ) : (
          <button
            className="primary"
            onClick={() => void startDownload()}
            data-testid="download-model"
          >
            Download model
          </button>
        )}
        {downloadError && <p className="error-banner">{downloadError}</p>}
      </section>
      <section className="card">
        <h2>2. Local response model (Ollama)</h2>
        {ollamaReady ? (
          <>
            <p role="status">
              ✓ Ollama is running with {ollamaProbe?.models?.length ?? 0} model(s).
            </p>
            <label className="field">
              <span>Response model</span>
              <select
                value={settings.llmModelId}
                onChange={async (e) => {
                  await window.cuedeck.updatePublicSettings({ llmModelId: e.target.value });
                  await onSettingsChanged();
                }}
              >
                <option value="">Choose a model…</option>
                {ollamaProbe?.models?.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : (
          <>
            <p>
              {ollamaProbe?.status === 'missing-model'
                ? 'Ollama is running but has no models. Install one, e.g. "ollama pull qwen2.5:3b-instruct".'
                : 'Ollama was not detected. Install it, then start it — CueDeck talks to it only on this computer (localhost).'}
            </p>
            <div className="row">
              <button
                onClick={() => void window.cuedeck.openExternal('https://ollama.com/download')}
              >
                Get Ollama
              </button>
              <button onClick={() => void probeAll(true)}>Check again</button>
            </div>
          </>
        )}
      </section>
      <button
        className="primary"
        onClick={onNext}
        disabled={
          !sttReady ||
          !ollamaReady ||
          !ollamaProbe?.models?.some((m) => m.id === settings.llmModelId)
        }
        data-testid="local-setup-next"
      >
        Continue
      </button>
      <p className="warn-banner">
        Listen needs both models. Typed questions only need a response model. You can also go back
        and choose the demo or free cloud setup.
      </p>
      {(!sttReady || !ollamaReady || !settings.llmModelId) && (
        <button onClick={onNext} className="small">
          Continue to Coach with setup incomplete
        </button>
      )}
    </>
  );
}

function AudioTestStep({ onNext }: { onNext: () => void }): React.JSX.Element {
  const [running, setRunning] = useState(false);
  const [level, setLevel] = useState(0);
  const [result, setResult] = useState<'healthy' | 'silent' | 'failed' | null>(null);
  const recorderRef = useRef<ClipRecorder | null>(null);
  const peakRef = useRef(0);

  useEffect(
    () => () => {
      const recorder = recorderRef.current;
      recorderRef.current = null;
      if (recorder) void recorder.abort();
    },
    [],
  );

  const runTest = async () => {
    setResult(null);
    setRunning(true);
    peakRef.current = 0;
    const sessionId = crypto.randomUUID();
    const recorder = new ClipRecorder(5, {
      onLevel: (rms) => {
        setLevel(rms);
        peakRef.current = Math.max(peakRef.current, rms);
      },
      onAutoStop: () => {
        void finish();
      },
    });
    recorderRef.current = recorder;
    const finish = async () => {
      const r = recorderRef.current;
      recorderRef.current = null;
      if (r) await r.abort(); // test clip is discarded, never submitted
      setRunning(false);
      setResult(peakRef.current > 0.0015 ? 'healthy' : 'silent');
    };
    try {
      await window.cuedeck.armCapture(sessionId);
      await recorder.start();
    } catch {
      recorderRef.current = null;
      await recorder.abort();
      setRunning(false);
      setResult('failed');
    }
  };

  return (
    <>
      <h1>Test system audio</h1>
      <p>
        Play any audio on this computer (music, a video), then run a 5-second capture test. The test
        clip is discarded immediately.
      </p>
      {running && (
        <span className="recording-indicator" role="status">
          <span className="dot" aria-hidden="true" /> Recording test
        </span>
      )}
      <div className="meter" role="img" aria-label="audio test level">
        <div style={{ width: `${Math.min(100, level * 700)}%` }} />
      </div>
      <div className="row">
        <button className="primary" onClick={() => void runTest()} disabled={running}>
          {running ? 'Listening…' : 'Run 5-second test'}
        </button>
        <button onClick={onNext} disabled={running}>
          {result === 'healthy' ? 'Continue' : 'Skip test'}
        </button>
      </div>
      {result === 'healthy' && <p role="status">✓ System audio is healthy.</p>}
      {result === 'silent' && (
        <p className="warn-banner">
          The test heard only silence. Make sure audio is playing and the right output device is
          active.
        </p>
      )}
      {result === 'failed' && (
        <p className="error-banner">
          Capture failed. Try again, or continue and use diagnostics later.
        </p>
      )}
    </>
  );
}

function ProfileStep({
  onNext,
  onSettingsChanged,
}: {
  onNext: () => Promise<void>;
  onSettingsChanged: () => Promise<void>;
}): React.JSX.Element {
  const [name, setName] = useState('My background');
  const [summary, setSummary] = useState('');
  const [roleContext, setRoleContext] = useState('');
  const [callType, setCallType] = useState<CallType>('general');
  const [techStack, setTechStack] = useState('');
  const [saving, setSaving] = useState(false);

  return (
    <>
      <h1>Add your background (optional)</h1>
      <p>
        CueDeck grounds responses in what you provide here — it is instructed never to invent
        experience you did not list. Pick the kind of call this profile is for; you can add one
        profile per call type (a React interview, a sales demo) later in Preferences.
      </p>
      <label className="field">
        <span>Profile name</span>
        <input maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <CallTypeFields
        draft={{ callType, techStack }}
        onChange={(patch) => {
          if (patch.callType !== undefined) setCallType(patch.callType);
          if (patch.techStack !== undefined) setTechStack(patch.techStack);
        }}
      />
      <label className="field">
        <span>Your background / resume summary ({summary.length} characters)</span>
        <textarea
          maxLength={20000}
          rows={6}
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
        />
      </label>
      <label className="field">
        <span>Role or call context (job description, account, meeting goal)</span>
        <textarea
          maxLength={20000}
          rows={4}
          value={roleContext}
          onChange={(e) => setRoleContext(e.target.value)}
        />
      </label>
      <div className="row">
        <button
          className="primary"
          disabled={saving}
          data-testid="finish-onboarding"
          onClick={async () => {
            setSaving(true);
            try {
              if (summary.trim() || roleContext.trim() || techStack.trim()) {
                const profile = await window.cuedeck.saveProfile({
                  name: name.trim() || 'My background',
                  summary,
                  roleContext,
                  emphasisNotes: '',
                  callType,
                  techStack,
                });
                await window.cuedeck.updatePublicSettings({ activeProfileId: profile.id });
                await onSettingsChanged();
              }
              await onNext();
            } finally {
              setSaving(false);
            }
          }}
        >
          Finish setup
        </button>
      </div>
    </>
  );
}
