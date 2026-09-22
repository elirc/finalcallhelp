import React from 'react';

export function NotesCard({
  notes,
  onChange,
}: {
  notes: string;
  onChange: (value: string) => void;
}): React.JSX.Element {
  return (
    <section className="card">
      <h2>
        Session notes
        <span className="actions">
          {notes !== '' && (
            <button className="small" onClick={() => onChange('')} data-testid="notes-clear">
              Clear
            </button>
          )}
        </span>
      </h2>
      <textarea
        aria-label="session notes"
        rows={2}
        maxLength={4000}
        placeholder="Optional context for this call — company, role, points to hit. Sent with every response request."
        value={notes}
        onChange={(e) => onChange(e.target.value)}
        data-testid="session-notes-input"
      />
    </section>
  );
}
