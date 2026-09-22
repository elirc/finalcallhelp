import React from 'react';
import { answerStats } from '../../shared/answerStats';
import { callTypePreset } from '../../shared/callTypes';
import type { PreferencesSection, PublicError, PublicSettings } from '../../shared/domain';
import { CaptureBar } from '../coach/CaptureBar';
import { ModeCard } from '../coach/ModeCard';
import { NotesCard } from '../coach/NotesCard';
import { PracticeCard } from '../coach/PracticeCard';
import { ProfileSwitcher } from '../coach/ProfileSwitcher';
import { ResponseCard } from '../coach/ResponseCard';
import { SetupBanner } from '../coach/SetupBanner';
import { StatusRail } from '../coach/StatusRail';
import { TranscriptCard } from '../coach/TranscriptCard';
import { useCoachSession } from '../coach/useCoachSession';
import { useProfiles } from '../state/useProfiles';
import { useSettingsUpdate } from '../state/useSettingsUpdate';

interface Props {
  settings: PublicSettings;
  onSettingsChanged: () => Promise<void>;
}

const PHASE_LABEL: Record<string, string> = {
  unconfigured: 'Setup needed',
  checking: 'Checking…',
  ready: 'Ready',
  arming_capture: 'Starting…',
  recording: 'Recording',
  encoding: 'Encoding…',
  transcribing: 'Transcribing…',
  generating: 'Generating…',
  complete: 'Done',
  cancelling: 'Cancelling…',
  failed: 'Failed',
};

/** Which preferences section fixes each error action. */
const ERROR_SECTION: Record<NonNullable<PublicError['action']>, PreferencesSection> = {
  'open-diagnostics': 'diagnostics',
  'replace-key': 'providers',
  'download-model': 'providers',
  'switch-provider': 'providers',
};

const FONT_SCALE_MIN = 0.9;
const FONT_SCALE_MAX = 1.6;

/**
 * Coach window. Layout order is deliberate: title bar, capture controls,
 * then the response card at the top of the scrolling area, so the answer
 * sits at the top of a window that docks at eye line under the camera.
 * Everything below the response is setup or practice and hides in the
 * compact (eye-line) layout.
 */
export function Coach({ settings, onSettingsChanged }: Props): React.JSX.Element {
  const session = useCoachSession(settings);
  const { state, readiness, busy, isRecording } = session;
  const update = useSettingsUpdate(onSettingsChanged);
  const { profiles } = useProfiles(settings.activeProfileId ?? '');
  const activeProfile = profiles.find((p) => p.id === settings.activeProfileId) ?? null;
  const preset = callTypePreset(activeProfile?.callType);

  const localMode =
    settings.sttProviderId === 'local-whisper' && settings.llmProviderId === 'ollama';
  const compact = settings.compactMode;
  const showSilenceWarning = isRecording && state.silentSoFar && state.elapsedMs > 3000;
  const stats =
    state.phase === 'complete' ? answerStats(state.answer, session.responseTargetSeconds) : null;
  const phaseLabel =
    state.phase === 'ready'
      ? readiness.checking
        ? 'Checking…'
        : readiness.llmReady
          ? 'Ready'
          : 'Setup needed'
      : (PHASE_LABEL[state.phase] ?? state.phase);
  const chipTone =
    (state.phase === 'ready' && readiness.llmReady) || state.phase === 'complete'
      ? 'ready'
      : state.phase === 'failed'
        ? 'error'
        : '';

  const setup = () => void update({ onboardingComplete: false });
  const changeFontScale = (delta: number) => {
    const next = Math.round((settings.fontScale + delta) * 100) / 100;
    void update({ fontScale: Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, next)) });
  };

  return (
    <div className={`app-shell${compact ? ' compact' : ''}`}>
      <header className="titlebar">
        <span className="brand">CueDeck</span>
        <span className={`status-chip ${chipTone}`} data-testid="phase-chip">
          {readiness.demo ? 'Demo' : localMode ? 'Local' : 'Cloud'} • {phaseLabel}
        </span>
        {isRecording && (
          <span className="recording-indicator" data-testid="recording-indicator" role="status">
            <span className="dot" aria-hidden="true" /> Recording
          </span>
        )}
        <ProfileSwitcher
          profiles={profiles}
          activeProfileId={settings.activeProfileId}
          disabled={busy}
          onChange={(id) => void update({ activeProfileId: id })}
        />
        <span className="spacer" />
        <button
          className="small"
          onClick={() => void window.cuedeck.dockEyeLine()}
          title="Move this window to the top-centre of the screen, under the camera, and keep it on top"
          data-testid="dock-eye-line"
        >
          Eye line
        </button>
        <button className="small" onClick={() => void update({ compactMode: !compact })}>
          {compact ? 'Expand' : 'Compact'}
        </button>
        <button
          className="small"
          onClick={() => void window.cuedeck.openPreferences()}
          data-testid="open-preferences"
        >
          Settings
        </button>
      </header>

      <CaptureBar
        isRecording={isRecording}
        busy={busy}
        canListen={readiness.canListen}
        elapsedMs={state.elapsedMs}
        rms={state.level.rms}
        autoStop={settings.autoStopOnSilence}
        showSilenceWarning={showSilenceWarning}
        onStart={() => void session.startRecording()}
        onStop={() => void session.stopRecording()}
        onCancel={() => void session.cancel()}
        onAutoStopChange={(autoStopOnSilence) => void update({ autoStopOnSilence })}
      />

      <main className="coach-body">
        <SetupBanner
          settings={settings}
          readiness={readiness}
          busy={busy}
          compact={compact}
          onSetup={setup}
          onSettingsChanged={onSettingsChanged}
        />

        {state.error && (
          <div className="error-banner" role="alert" data-testid="error-banner">
            <span>{state.error.message}</span>
            {state.error.action && (
              <button
                className="small"
                onClick={() =>
                  void window.cuedeck.openPreferences(
                    ERROR_SECTION[state.error?.action ?? 'open-diagnostics'],
                  )
                }
              >
                Open settings
              </button>
            )}
            <button className="small" onClick={session.reset}>
              Dismiss
            </button>
          </div>
        )}

        <ResponseCard
          answer={state.answer}
          phase={state.phase}
          stats={stats}
          targetSeconds={session.responseTargetSeconds}
          copied={session.copied}
          busy={busy}
          hasTranscript={state.transcript.trim() !== ''}
          canRespond={readiness.canRespond}
          fontScale={settings.fontScale}
          onCopy={() => void session.copyAnswer()}
          onClear={session.reset}
          onFollowUp={(overrides) => void session.regenerate(overrides)}
          onFontScale={changeFontScale}
        />

        {!compact && (
          <TranscriptCard
            transcript={state.transcript}
            phase={state.phase}
            demo={readiness.demo}
            respondDisabled={!state.transcript.trim() || busy || !readiness.canRespond}
            onChange={session.setTranscript}
            onRespond={() => void session.regenerate()}
          />
        )}

        {!compact && (
          <PracticeCard
            disabled={busy}
            suggestedCategory={preset.practiceCategory}
            onQuestion={(text) => {
              session.setTranscript(text);
              session.setLiveMessage('Practice question ready.');
            }}
          />
        )}

        {!compact && <NotesCard notes={session.notes} onChange={session.setNotes} />}

        {!compact && (
          <ModeCard
            answerMode={settings.answerMode}
            suggestedMode={activeProfile ? preset.suggestedMode : null}
            onChange={(answerMode) => void update({ answerMode })}
          />
        )}
      </main>

      <StatusRail
        settings={settings}
        metrics={state.metrics}
        profileLabel={activeProfile ? `${activeProfile.name} · ${preset.label}` : null}
      />
      <div aria-live="polite" className="visually-hidden">
        {session.liveMessage}
      </div>
    </div>
  );
}
