import React from 'react';
import type { AnswerStats } from '../../shared/answerStats';
import type { SessionState } from '../../shared/domain';
import type { FollowUp } from './useCoachSession';

/**
 * The response itself, first in the layout so it sits at the top of the
 * window (and, when docked, at eye line under the camera).
 */
export function ResponseCard({
  answer,
  phase,
  stats,
  targetSeconds,
  copied,
  busy,
  hasTranscript,
  canRespond,
  fontScale,
  onCopy,
  onClear,
  onFollowUp,
  onFontScale,
}: {
  answer: string;
  phase: SessionState;
  stats: AnswerStats | null;
  targetSeconds: number;
  copied: boolean;
  busy: boolean;
  hasTranscript: boolean;
  canRespond: boolean;
  fontScale: number;
  onCopy: () => void;
  onClear: () => void;
  onFollowUp: (overrides?: FollowUp) => void;
  onFontScale: (delta: number) => void;
}): React.JSX.Element {
  const followUpsDisabled = !hasTranscript || busy || !canRespond;
  const placeholder =
    phase === 'transcribing'
      ? 'Transcribing what was said…'
      : phase === 'generating'
        ? ''
        : phase === 'recording'
          ? 'Listening… the response appears here as soon as the speaker pauses.'
          : 'Your response appears here. Press Listen, or type a question below.';
  return (
    <section className="card response-card" aria-label="response">
      <h2>
        Response
        <span className="actions">
          <button
            className="small"
            onClick={() => onFontScale(-0.1)}
            aria-label="Smaller text"
            title="Smaller text"
            disabled={fontScale <= 0.9}
          >
            A−
          </button>
          <button
            className="small"
            onClick={() => onFontScale(0.1)}
            aria-label="Larger text"
            title="Larger text"
            disabled={fontScale >= 1.6}
          >
            A+
          </button>
          <button
            className="small"
            onClick={onCopy}
            disabled={!answer}
            data-testid="copy-button"
            title="Ctrl+Shift+C"
          >
            {copied ? 'Copied ✓' : 'Copy'}
          </button>
          <button
            className="small"
            onClick={onClear}
            disabled={busy || (!answer && !hasTranscript)}
            data-testid="clear-button"
          >
            Clear
          </button>
        </span>
      </h2>
      <div className="answer-text" data-testid="answer-text" aria-live="off">
        {answer}
        {phase === 'generating' && <span className="caret">&nbsp;</span>}
        {!answer && placeholder && <span className="answer-placeholder">{placeholder}</span>}
      </div>
      {stats && (
        <p className="answer-stats" data-testid="answer-stats">
          ~{stats.seconds} s spoken ({stats.words} words) —{' '}
          {stats.verdict === 'on-target'
            ? `about right for your ${targetSeconds} s target`
            : stats.verdict === 'long'
              ? `longer than your ${targetSeconds} s target`
              : `shorter than your ${targetSeconds} s target`}
        </p>
      )}
      <div className="mode-row" role="group" aria-label="response follow-ups">
        <button
          className="small"
          disabled={followUpsDisabled}
          onClick={() => onFollowUp({ targetSeconds: 15 })}
        >
          Shorter
        </button>
        <button
          className="small"
          disabled={followUpsDisabled}
          onClick={() => onFollowUp({ answerMode: 'bullets' })}
        >
          Bullets
        </button>
        <button
          className="small"
          disabled={followUpsDisabled}
          onClick={() => onFollowUp({ answerMode: 'star' })}
        >
          STAR
        </button>
        <button
          className="small"
          disabled={followUpsDisabled}
          onClick={() => onFollowUp({ answerMode: 'concise' })}
        >
          More concise
        </button>
        <button
          className="small"
          disabled={followUpsDisabled}
          onClick={() => onFollowUp()}
          data-testid="try-again-button"
        >
          Try again
        </button>
      </div>
    </section>
  );
}
