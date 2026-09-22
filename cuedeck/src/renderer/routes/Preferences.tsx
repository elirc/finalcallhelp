import React, { useEffect, useState } from 'react';
import type { PreferencesSection, PublicSettings } from '../../shared/domain';
import { AboutSection } from '../preferences/AboutSection';
import { DiagnosticsSection } from '../preferences/DiagnosticsSection';
import { GeneralSection } from '../preferences/GeneralSection';
import { HistorySection } from '../preferences/HistorySection';
import { ProfilesSection } from '../preferences/ProfilesSection';
import { ProvidersSection } from '../preferences/ProvidersSection';

interface Props {
  settings: PublicSettings;
  onSettingsChanged: () => Promise<void>;
  /** From the route (`#/preferences/<section>`), used for deep links. */
  initialSection?: string;
}

const SECTIONS: Array<[PreferencesSection, string]> = [
  ['general', 'General'],
  ['providers', 'Providers'],
  ['profiles', 'Profiles'],
  ['history', 'History'],
  ['diagnostics', 'Diagnostics'],
  ['about', 'Privacy & consent'],
];

function isSection(value: string | undefined): value is PreferencesSection {
  return SECTIONS.some(([id]) => id === value);
}

export function Preferences({
  settings,
  onSettingsChanged,
  initialSection,
}: Props): React.JSX.Element {
  const [section, setSection] = useState<PreferencesSection>(
    isSection(initialSection) ? initialSection : 'general',
  );

  useEffect(() => {
    // The coach deep-links here ("Open settings" on an error, profile Edit)
    // and the window is reused rather than re-created, so listen for later
    // navigations too.
    return window.cuedeck.onPreferencesNavigate((next) => setSection(next));
  }, []);

  return (
    <div className="app-shell">
      <header className="titlebar">
        <span className="brand">CueDeck Preferences</span>
      </header>
      <div className="prefs-shell">
        <nav className="prefs-nav" aria-label="preference sections">
          {SECTIONS.map(([id, label]) => (
            <button
              key={id}
              aria-current={section === id}
              onClick={() => setSection(id)}
              data-testid={`nav-${id}`}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="prefs-content">
          {section === 'general' && (
            <GeneralSection settings={settings} onSettingsChanged={onSettingsChanged} />
          )}
          {section === 'providers' && (
            <ProvidersSection settings={settings} onSettingsChanged={onSettingsChanged} />
          )}
          {section === 'profiles' && (
            <ProfilesSection settings={settings} onSettingsChanged={onSettingsChanged} />
          )}
          {section === 'history' && (
            <HistorySection settings={settings} onSettingsChanged={onSettingsChanged} />
          )}
          {section === 'diagnostics' && <DiagnosticsSection />}
          {section === 'about' && <AboutSection />}
        </div>
      </div>
    </div>
  );
}
