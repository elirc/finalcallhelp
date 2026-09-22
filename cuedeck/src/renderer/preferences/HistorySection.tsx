import React, { useEffect, useState } from 'react';
import type { HistoryItem, PublicSettings } from '../../shared/domain';
import { filterHistory } from '../../shared/historySearch';
import { ConfirmButton } from '../components/ConfirmButton';
import { useSettingsUpdate } from '../state/useSettingsUpdate';
import type { SectionProps } from './types';

function download(filename: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function HistorySection({ settings, onSettingsChanged }: SectionProps): React.JSX.Element {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [query, setQuery] = useState('');
  const visible = filterHistory(items, query);
  const update = useSettingsUpdate(onSettingsChanged);

  const refresh = async () => setItems(await window.cuedeck.listHistory());
  useEffect(() => {
    void refresh();
  }, [settings.historyEnabled, settings.historyRetentionDays]);

  return (
    <>
      <h1>History</h1>
      <label className="row">
        <input
          type="checkbox"
          style={{ width: 'auto' }}
          checked={settings.historyEnabled}
          onChange={(e) => void update({ historyEnabled: e.target.checked })}
          data-testid="history-toggle"
        />
        <span>
          Save transcripts and responses locally (off by default; raw audio is never saved)
        </span>
      </label>
      <label className="field">
        <span>Keep history for</span>
        <select
          value={settings.historyRetentionDays}
          onChange={(e) =>
            void update({
              historyRetentionDays: Number(
                e.target.value,
              ) as PublicSettings['historyRetentionDays'],
            })
          }
        >
          <option value={1}>1 day</option>
          <option value={7}>7 days</option>
          <option value={30}>30 days</option>
          <option value={0}>Do not keep (session only)</option>
        </select>
      </label>
      <div className="row">
        <button className="small" onClick={() => void refresh()}>
          Refresh history
        </button>
        <button
          className="small"
          disabled={items.length === 0}
          onClick={async () => {
            const all = await window.cuedeck.exportHistory();
            download('cuedeck-history.json', JSON.stringify(all, null, 2), 'application/json');
          }}
        >
          Export JSON
        </button>
        <button
          className="small"
          disabled={items.length === 0}
          onClick={async () => {
            const all = await window.cuedeck.exportHistory();
            const md = all
              .map(
                (i) =>
                  `## ${i.createdAt}\n\n**Heard:** ${i.transcript}\n\n**Response:** ${i.answer}\n`,
              )
              .join('\n');
            download('cuedeck-history.md', md, 'text/markdown');
          }}
        >
          Export Markdown
        </button>
        <ConfirmButton
          label="Delete all"
          confirmLabel="Confirm delete all"
          onConfirm={async () => {
            await window.cuedeck.clearHistory();
            await refresh();
          }}
        />
      </div>
      {items.length > 0 && (
        <label className="field">
          <span>
            Search saved sessions
            {query.trim() !== '' ? ` — ${visible.length} of ${items.length} shown` : ''}
          </span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by any words in the transcript or response"
            data-testid="history-search"
          />
        </label>
      )}
      <table className="history">
        <tbody>
          {visible.map((i) => (
            <tr key={i.id}>
              <td>{new Date(i.createdAt).toLocaleString()}</td>
              <td>
                <div>
                  <strong>{i.transcript.slice(0, 120)}</strong>
                </div>
                <div>{i.answer.slice(0, 160)}</div>
              </td>
              <td>
                <button
                  className="small danger"
                  onClick={async () => {
                    await window.cuedeck.deleteHistoryItem(i.id);
                    await refresh();
                  }}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {settings.historyEnabled && items.length === 0 && <p>No saved sessions yet.</p>}
      {items.length > 0 && visible.length === 0 && <p>No sessions match your search.</p>}
    </>
  );
}
