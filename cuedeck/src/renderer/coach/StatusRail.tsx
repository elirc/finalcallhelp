import React from 'react';
import type { PublicSettings, SessionMetrics } from '../../shared/domain';

export function StatusRail({
  settings,
  metrics,
  profileLabel,
}: {
  settings: PublicSettings;
  metrics: SessionMetrics | null;
  profileLabel: string | null;
}): React.JSX.Element {
  return (
    <footer className="status-rail" data-testid="status-rail">
      <span>
        {settings.sttProviderId === 'local-whisper' ? 'Local Whisper' : settings.sttProviderId} (
        {settings.sttModelId.split('/').pop()})
      </span>
      <span>•</span>
      <span>
        {settings.llmModelId || 'no model'} via {settings.llmProviderId}
      </span>
      {profileLabel && (
        <>
          <span>•</span>
          <span data-testid="status-profile">{profileLabel}</span>
        </>
      )}
      {metrics && (
        <>
          <span>•</span>
          <span>{(metrics.totalMs / 1000).toFixed(1)} s total</span>
          {metrics.transcribeMs !== undefined && metrics.transcribeMs > 0 && (
            <span>({(metrics.transcribeMs / 1000).toFixed(1)} s transcribe)</span>
          )}
          {metrics.firstTokenMs !== undefined && (
            <span>({(metrics.firstTokenMs / 1000).toFixed(1)} s to first words)</span>
          )}
        </>
      )}
      <span className="spacer" />
      <span className="shortcuts" aria-label="keyboard shortcuts">
        Ctrl+L listen · Esc cancel · Ctrl+Shift+C copy
      </span>
    </footer>
  );
}
