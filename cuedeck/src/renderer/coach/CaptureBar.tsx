import React from 'react';

function formatTime(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Listen / Stop / Cancel plus the live meter. Rendered as a fixed strip
 * under the title bar so the controls never scroll away from the response.
 */
export function CaptureBar({
  isRecording,
  busy,
  canListen,
  elapsedMs,
  rms,
  autoStop,
  showSilenceWarning,
  onStart,
  onStop,
  onCancel,
  onAutoStopChange,
}: {
  isRecording: boolean;
  busy: boolean;
  canListen: boolean;
  elapsedMs: number;
  rms: number;
  autoStop: boolean;
  showSilenceWarning: boolean;
  onStart: () => void;
  onStop: () => void;
  onCancel: () => void;
  onAutoStopChange: (value: boolean) => void;
}): React.JSX.Element {
  return (
    <section className="capture-bar" aria-label="capture controls">
      <div className="capture-row">
        {!isRecording ? (
          <button
            className="primary"
            onClick={onStart}
            disabled={busy || !canListen}
            data-testid="listen-button"
            title="Ctrl+L"
          >
            Listen
          </button>
        ) : (
          <button className="primary" onClick={onStop} data-testid="stop-button" title="Ctrl+L">
            Stop &amp; respond
          </button>
        )}
        {busy && (
          <button onClick={onCancel} data-testid="cancel-button" title="Esc">
            Cancel
          </button>
        )}
        <span className="timer" aria-label="elapsed recording time">
          {formatTime(elapsedMs)}
        </span>
        <div className="meter" role="img" aria-label="audio input level">
          <div style={{ width: `${Math.min(100, rms * 700)}%` }} />
        </div>
        <label className="auto-stop">
          <input
            type="checkbox"
            style={{ width: 'auto' }}
            checked={autoStop}
            onChange={(e) => onAutoStopChange(e.target.checked)}
            data-testid="auto-stop-toggle"
          />
          <span>Auto-respond on pause</span>
        </label>
      </div>
      {showSilenceWarning && (
        <p className="warn-banner" role="alert">
          No audio detected yet — check that the conversation audio is playing on this computer.
        </p>
      )}
    </section>
  );
}
