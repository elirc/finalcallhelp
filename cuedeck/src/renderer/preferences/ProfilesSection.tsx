import React, { useEffect, useState } from 'react';
import { callTypePreset } from '../../shared/callTypes';
import type { Profile } from '../../shared/domain';
import { ConfirmButton } from '../components/ConfirmButton';
import { CallTypeFields, EMPTY_PROFILE_DRAFT, type ProfileDraft } from '../profiles/ProfileFields';
import { useSettingsUpdate } from '../state/useSettingsUpdate';
import type { SectionProps } from './types';

function toDraft(profile: Profile): ProfileDraft & { id: string } {
  return {
    id: profile.id,
    name: profile.name,
    summary: profile.summary,
    roleContext: profile.roleContext,
    emphasisNotes: profile.emphasisNotes,
    callType: profile.callType ?? 'general',
    techStack: profile.techStack ?? '',
  };
}

export function ProfilesSection({ settings, onSettingsChanged }: SectionProps): React.JSX.Element {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [editing, setEditing] = useState<(ProfileDraft & { id?: string }) | null>(null);
  const update = useSettingsUpdate(onSettingsChanged);

  const refresh = async () => setProfiles(await window.cuedeck.listProfiles());
  useEffect(() => {
    void refresh();
  }, []);

  const contextSize = editing
    ? editing.summary.length +
      editing.roleContext.length +
      editing.emphasisNotes.length +
      editing.techStack.length
    : 0;

  return (
    <>
      <h1>Profiles</h1>
      <p>
        Profiles ground responses in your real background. Stored only on this computer. Keep one
        per kind of call — a technical-interview profile with your stack, a sales profile with your
        product — and switch between them from the coach window.
      </p>
      {profiles.map((p) => (
        <div
          key={p.id}
          className="card row"
          style={{ justifyContent: 'space-between', marginBottom: 8 }}
        >
          <span>
            <strong>{p.name}</strong>
            <span className="hint" style={{ margin: '0 0 0 8px', display: 'inline' }}>
              {callTypePreset(p.callType).label}
            </span>
            {settings.activeProfileId === p.id ? ' — active' : ''}
          </span>
          <span className="row">
            {settings.activeProfileId !== p.id && (
              <button className="small" onClick={() => void update({ activeProfileId: p.id })}>
                Make active
              </button>
            )}
            <button className="small" onClick={() => setEditing(toDraft(p))}>
              Edit
            </button>
            <ConfirmButton
              label="Delete"
              confirmLabel="Confirm delete"
              onConfirm={async () => {
                await window.cuedeck.deleteProfile(p.id);
                await refresh();
              }}
            />
          </span>
        </div>
      ))}
      {editing ? (
        <div className="card">
          <label className="field">
            <span>Name</span>
            <input
              value={editing.name}
              maxLength={120}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            />
          </label>
          <CallTypeFields
            draft={editing}
            onChange={(patch) => setEditing({ ...editing, ...patch })}
          />
          <label className="field">
            <span>Background / resume summary</span>
            <textarea
              rows={6}
              maxLength={20000}
              value={editing.summary}
              onChange={(e) => setEditing({ ...editing, summary: e.target.value })}
            />
          </label>
          <label className="field">
            <span>Role / call context</span>
            <textarea
              rows={4}
              maxLength={20000}
              value={editing.roleContext}
              onChange={(e) => setEditing({ ...editing, roleContext: e.target.value })}
            />
          </label>
          <label className="field">
            <span>Things to emphasize</span>
            <textarea
              rows={2}
              maxLength={8000}
              value={editing.emphasisNotes}
              onChange={(e) => setEditing({ ...editing, emphasisNotes: e.target.value })}
            />
          </label>
          <p style={{ color: contextSize > 24_000 ? 'var(--warning)' : 'var(--muted)' }}>
            {contextSize.toLocaleString()} characters (~
            {Math.round(contextSize / 4).toLocaleString()} tokens)
            {contextSize > 24_000 ? ' — this is a lot of context; responses may slow down.' : ''}
          </p>
          <div className="row">
            <button
              className="primary"
              disabled={!editing.name.trim()}
              onClick={async () => {
                await window.cuedeck.saveProfile({
                  id: editing.id,
                  name: editing.name.trim(),
                  summary: editing.summary,
                  roleContext: editing.roleContext,
                  emphasisNotes: editing.emphasisNotes,
                  callType: editing.callType,
                  techStack: editing.techStack,
                });
                setEditing(null);
                await refresh();
              }}
            >
              Save profile
            </button>
            <button onClick={() => setEditing(null)}>Discard</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setEditing({ ...EMPTY_PROFILE_DRAFT })}>New profile</button>
      )}
    </>
  );
}
