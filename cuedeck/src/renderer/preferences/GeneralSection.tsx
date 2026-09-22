import React, { useEffect, useState } from 'react';
import type { PublicSettings } from '../../shared/domain';
import type { SectionProps } from './types';

export function GeneralSection({
  settings: savedSettings,
  onSettingsChanged,
}: SectionProps): React.JSX.Element {
  // Optimistic local copy so sliders feel immediate; rolled back on failure.
  const [settings, setSettings] = useState(savedSettings);
  useEffect(() => setSettings(savedSettings), [savedSettings]);
  const update = async (patch: Partial<PublicSettings>) => {
    setSettings((current) => ({ ...current, ...patch }));
    try {
      await window.cuedeck.updatePublicSettings(patch);
      await onSettingsChanged();
    } catch (err) {
      setSettings(savedSettings);
      throw err;
    }
  };
  return (
    <>
      <h1>General</h1>
      <section className="card">
        <h2>Window</h2>
        <p>
          On a call, keep the response where your eyes already are: docked top-centre of the screen,
          right under the camera, above the meeting window.
        </p>
        <div className="row">
          <button onClick={() => void window.cuedeck.dockEyeLine()}>Dock at eye level now</button>
        </div>
        <label className="row">
          <input
            type="checkbox"
            style={{ width: 'auto' }}
            checked={settings.alwaysOnTop}
            onChange={(e) => void update({ alwaysOnTop: e.target.checked })}
          />
          <span>Keep the coach window on top of other windows</span>
        </label>
        <label className="row">
          <input
            type="checkbox"
            style={{ width: 'auto' }}
            checked={settings.compactMode}
            onChange={(e) => void update({ compactMode: e.target.checked })}
          />
          <span>
            Compact coach layout (eye-line): response first in larger text, capture controls only
          </span>
        </label>
        <label className="field">
          <span>Text size ({Math.round(settings.fontScale * 100)}%)</span>
          <input
            type="range"
            min={0.9}
            max={1.6}
            step={0.05}
            value={settings.fontScale}
            onChange={(e) => void update({ fontScale: Number(e.target.value) })}
          />
        </label>
      </section>
      <section className="card">
        <h2>Capture and responses</h2>
        <label className="field">
          <span>Maximum clip length: {settings.maxClipSeconds} seconds</span>
          <input
            type="range"
            min={30}
            max={120}
            step={5}
            value={settings.maxClipSeconds}
            onChange={(e) => void update({ maxClipSeconds: Number(e.target.value) })}
          />
        </label>
        <label className="field">
          <span>Target speaking time</span>
          <select
            value={settings.targetSeconds}
            onChange={(e) =>
              void update({
                targetSeconds: Number(e.target.value) as PublicSettings['targetSeconds'],
              })
            }
          >
            <option value={15}>15 seconds</option>
            <option value={30}>30 seconds</option>
            <option value={60}>60 seconds</option>
          </select>
        </label>
        <label className="field">
          <span>Transcription language</span>
          <select
            value={settings.sttLanguage}
            onChange={(e) => void update({ sttLanguage: e.target.value })}
          >
            <option value="auto">Detect automatically</option>
            <option value="en">English</option>
            <option value="es">Spanish</option>
            <option value="fr">French</option>
            <option value="de">German</option>
            <option value="zh">Chinese</option>
            <option value="tl">Tagalog</option>
          </select>
        </label>
      </section>
    </>
  );
}
