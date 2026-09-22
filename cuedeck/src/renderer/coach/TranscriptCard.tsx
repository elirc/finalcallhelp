import React from 'react';
import type { SessionState } from '../../shared/domain';

export function TranscriptCard({
  transcript,
  phase,
  demo,
  respondDisabled,
  onChange,
  onRespond,
}: {
  transcript: string;
  phase: SessionState;
  demo: boolean;
  respondDisabled: boolean;
  onChange: (text: string) => void;
  onRespond: () => void;
}): React.JSX.Element {
  return (
    <section className="card">
      <h2>
        Heard
        <span className="actions">
          <button
            className="small"
            onClick={onRespond}
            disabled={respondDisabled}
            data-testid="regenerate-button"
          >
            {demo ? 'Show sample response' : 'Respond to edited text'}
          </button>
        </span>
      </h2>
      <textarea
        aria-label="transcript (editable)"
        placeholder="Type a question here, or draw one from the practice deck."
        maxLength={40000}
        value={transcript}
        onChange={(e) => onChange(e.target.value)}
        disabled={phase === 'transcribing' || phase === 'generating'}
        data-testid="transcript-input"
      />
    </section>
  );
}
