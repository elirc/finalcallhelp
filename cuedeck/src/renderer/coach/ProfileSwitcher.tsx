import React from 'react';
import { callTypePreset } from '../../shared/callTypes';
import type { Profile } from '../../shared/domain';

/**
 * Switch the active profile without leaving the coach. Each option shows
 * its call type so "React interview" and "Sales demo" profiles read at a
 * glance. Disabled while a session is running so the prompt that is being
 * built does not change under it.
 */
export function ProfileSwitcher({
  profiles,
  activeProfileId,
  disabled,
  onChange,
}: {
  profiles: Profile[];
  activeProfileId: string | undefined;
  disabled: boolean;
  onChange: (id: string | undefined) => void;
}): React.JSX.Element {
  const active = profiles.find((p) => p.id === activeProfileId);
  return (
    <div className="profile-switcher">
      <select
        aria-label="active profile"
        value={active ? active.id : ''}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value || undefined)}
        data-testid="profile-switcher"
      >
        <option value="">No profile (generic answers)</option>
        {profiles.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} — {callTypePreset(p.callType).label}
          </option>
        ))}
      </select>
      {profiles.length === 0 && (
        <button
          className="small"
          onClick={() => void window.cuedeck.openPreferences('profiles')}
          title="Create a profile in Preferences"
        >
          Add profile
        </button>
      )}
    </div>
  );
}
