import React, { useEffect, useState } from 'react';
import type { DiagnosticsReport } from '../../shared/domain';

export function DiagnosticsSection(): React.JSX.Element {
  const [report, setReport] = useState<DiagnosticsReport | null>(null);
  const [includeTranscripts, setIncludeTranscripts] = useState(false);
  const [includeProfile, setIncludeProfile] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void window.cuedeck.getDiagnostics().then(setReport);
  }, []);

  return (
    <>
      <h1>Diagnostics</h1>
      {report && (
        <section className="card">
          <p>
            CueDeck {report.appVersion} • Electron {report.electronVersion} • {report.platform}{' '}
            {report.osVersion}
          </p>
          <p>
            STT: {report.sttProviderId} • LLM: {report.llmProviderId} • Local model:{' '}
            {report.localModelStatus}
          </p>
          <h2>Recent errors (redacted)</h2>
          {report.recentErrors.length === 0 ? (
            <p>None.</p>
          ) : (
            <ul>
              {report.recentErrors.map((e, i) => (
                <li key={i}>
                  {e.at} [{e.code}] {e.message}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      <h2>Export</h2>
      <p>
        Exports never include API keys. Transcripts and profile text are excluded unless you select
        them.
      </p>
      <label className="row">
        <input
          type="checkbox"
          style={{ width: 'auto' }}
          checked={includeTranscripts}
          onChange={(e) => setIncludeTranscripts(e.target.checked)}
        />
        <span>Include recent transcripts (only if history is enabled)</span>
      </label>
      <label className="row">
        <input
          type="checkbox"
          style={{ width: 'auto' }}
          checked={includeProfile}
          onChange={(e) => setIncludeProfile(e.target.checked)}
        />
        <span>Include active profile text</span>
      </label>
      <button
        onClick={async () => {
          const text = await window.cuedeck.exportDiagnostics({
            includeTranscripts,
            includeProfile,
          });
          await navigator.clipboard.writeText(text);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2000);
        }}
      >
        {copied ? 'Copied ✓' : 'Copy diagnostics to clipboard'}
      </button>
    </>
  );
}
