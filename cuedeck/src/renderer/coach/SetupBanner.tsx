import React from 'react';
import type { PublicSettings } from '../../shared/domain';
import { setupPreset } from '../../shared/setup';
import type { useReadiness } from '../state/useReadiness';

type Readiness = ReturnType<typeof useReadiness>;

/**
 * What blocks Listen right now, with one-click ways out. Rendered twice by
 * the coach: `above` the response card for states where nothing can answer
 * yet (demo, checking, response provider not ready), and `below` it for the
 * slim "Listen is off" notice once typed questions work, so the answer keeps
 * the top of the window. Hidden as soon as both providers are ready.
 */
export function SetupBanner({
  settings,
  readiness,
  busy,
  compact,
  placement,
  onSetup,
  onSettingsChanged,
}: {
  settings: PublicSettings;
  readiness: Readiness;
  busy: boolean;
  /** Eye-line layout: one line, so the response keeps the top of the window. */
  compact: boolean;
  /** Where the coach renders this instance relative to the response card. */
  placement: 'above' | 'below';
  onSetup: () => void;
  onSettingsChanged: () => Promise<void>;
}): React.JSX.Element | null {
  if (compact) {
    // No transcript card in compact mode, so the one-line notice stays on top.
    if (placement !== 'above') return null;
    if (readiness.canListen || busy || readiness.checking) return null;
    const reason = readiness.demo
      ? 'Demo mode: Listen is off. Expand to type a question.'
      : readiness.llmReady
        ? 'Speech-to-text is not set up, so Listen is off. Expand to type questions.'
        : 'AI setup is incomplete, so Listen is off.';
    return (
      <div className="setup-slim" role="status" data-testid="readiness-banner">
        <span>{reason}</span>
        <button className="small" onClick={() => void window.cuedeck.openPreferences('providers')}>
          Open provider settings
        </button>
      </div>
    );
  }
  const typedOnly =
    readiness.llmReady && !readiness.canListen && !readiness.demo && !readiness.checking && !busy;
  if (placement === 'below') {
    if (!typedOnly) return null;
    return (
      <div className="setup-slim" role="status" data-testid="readiness-banner">
        <span>Speech-to-text is not set up, so Listen is off. Typed questions work.</span>
        <button className="small" onClick={() => void window.cuedeck.openPreferences('providers')}>
          Open provider settings
        </button>
        <button className="small" onClick={readiness.refresh}>
          Check again
        </button>
      </div>
    );
  }
  if (readiness.demo) {
    return (
      <section className="card setup-card" data-testid="demo-banner">
        <h2>Try CueDeck — no account needed</h2>
        <p>
          Demo streams a fixed sample response. It does not use AI or capture audio. Draw a practice
          question or type one below, then press Respond.
        </p>
        <button className="primary" onClick={onSetup} disabled={busy}>
          Set up real AI
        </button>
      </section>
    );
  }
  // Typed questions work: the slim notice below the answer covers it.
  if (readiness.canListen || busy || (readiness.llmReady && !readiness.checking)) return null;
  return (
    <section className="card setup-card" data-testid="readiness-banner" role="status">
      <h2>{readiness.checking ? 'Checking your setup…' : 'Finish your AI setup'}</h2>
      {!readiness.checking && (
        <>
          <p>
            {!settings.llmModelId
              ? 'Choose a response model, or connect a free cloud account to start testing.'
              : (readiness.llm?.detail ??
                `Response provider: ${readiness.llm?.status ?? 'not connected'}.`)}
          </p>
          {!readiness.sttReady && (
            <p className="hint">
              Audio: {readiness.stt?.detail ?? readiness.stt?.status ?? 'not configured'}.
            </p>
          )}
          <div className="row">
            <button className="primary" onClick={onSetup}>
              Set up real AI
            </button>
            <button onClick={() => void window.cuedeck.openPreferences('providers')}>
              Open provider settings
            </button>
            <button onClick={readiness.refresh}>Check again</button>
            <button
              onClick={async () => {
                await window.cuedeck.updatePublicSettings(setupPreset('demo'));
                await onSettingsChanged();
              }}
            >
              Try demo instead
            </button>
          </div>
        </>
      )}
    </section>
  );
}
