import React from 'react';
import type { AnswerMode } from '../../shared/domain';

const MODES: AnswerMode[] = ['natural', 'concise', 'bullets', 'star', 'clarify'];

export function ModeCard({
  answerMode,
  suggestedMode,
  onChange,
}: {
  answerMode: AnswerMode;
  suggestedMode: AnswerMode | null;
  onChange: (mode: AnswerMode) => void;
}): React.JSX.Element {
  return (
    <section className="card">
      <h2>Default response style</h2>
      <div className="mode-row" role="group" aria-label="answer mode">
        {MODES.map((mode) => (
          <button
            key={mode}
            className={`small${answerMode === mode ? ' selected' : ''}`}
            aria-pressed={answerMode === mode}
            onClick={() => onChange(mode)}
          >
            {mode === 'star' ? 'STAR' : mode[0].toUpperCase() + mode.slice(1)}
          </button>
        ))}
      </div>
      {suggestedMode && suggestedMode !== answerMode && (
        <p className="hint">
          Your active profile’s call type suggests{' '}
          <button className="link" onClick={() => onChange(suggestedMode)}>
            {suggestedMode === 'star' ? 'STAR' : suggestedMode}
          </button>
          .
        </p>
      )}
    </section>
  );
}
