import React, { useEffect, useState } from 'react';
import type { ModelSummary, PublicSettings } from '../../shared/domain';
import { errorMessage } from '../../shared/setup';

export function LocalModelPicker({
  settings,
  models,
  onLoad,
  onSettingsChanged,
}: {
  settings: PublicSettings;
  models: ModelSummary[] | undefined;
  onLoad: () => void;
  onSettingsChanged: () => Promise<void>;
}): React.JSX.Element {
  const [download, setDownload] = useState<{ operationId: string; value?: number } | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!models) onLoad();
  }, [models, onLoad]);

  useEffect(() => {
    return window.cuedeck.onOperationEvent((event) => {
      setDownload((current) => {
        if (!current || event.operationId !== current.operationId) return current;
        if (event.type === 'progress') return { ...current, value: event.value };
        if (event.type === 'complete') {
          setMessage('Model ready.');
          onLoad();
          return null;
        }
        setMessage(event.type === 'error' ? event.error.message : null);
        return null;
      });
    });
  }, [onLoad]);

  return (
    <>
      <label className="field">
        <span>Local model (downloaded on demand; stored in app data)</span>
        <select
          value={settings.sttModelId}
          disabled={!!download}
          onChange={async (e) => {
            await window.cuedeck.updatePublicSettings({ sttModelId: e.target.value });
            await onSettingsChanged();
          }}
        >
          {(models ?? []).map((m) => (
            <option key={m.id} value={m.id}>
              {m.displayName}
              {m.installed ? ' — installed' : ''}
            </option>
          ))}
        </select>
      </label>
      {download ? (
        <div className="row">
          <div className="progress-bar" style={{ flex: 1 }}>
            <div style={{ width: `${download.value ?? 5}%` }} />
          </div>
          <button
            className="small"
            onClick={() => void window.cuedeck.cancelDownload(download.operationId)}
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          className="small"
          onClick={async () => {
            setMessage(null);
            const operationId = crypto.randomUUID();
            setDownload({ operationId });
            try {
              await window.cuedeck.downloadModel(settings.sttModelId, operationId);
            } catch (err) {
              setDownload(null);
              setMessage(errorMessage(err));
            }
          }}
        >
          Download / verify selected model
        </button>
      )}
      {message && <p role="status">{message}</p>}
    </>
  );
}
