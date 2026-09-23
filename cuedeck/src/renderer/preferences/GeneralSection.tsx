import React, { useEffect, useRef, useState } from 'react';
import type { PublicSettings } from '../../shared/domain';
import type { SectionProps } from './types';

const SLIDER_DEBOUNCE_MS = 150;

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
  // Sliders fire on every tick: show the value live, but write settings (an
  // atomic file write plus a broadcast to both windows) at most once per
  // pause in dragging.
  const slidePatch = useRef<Partial<PublicSettings>>({});
  const slideTimer = useRef<number | undefined>(undefined);
  // On unmount (switching section), write a pending slider value now rather
  // than dropping it. The main process broadcasts the change to both windows.
  useEffect(
    () => () => {
      window.clearTimeout(slideTimer.current);
      const pending = slidePatch.current;
      slidePatch.current = {};
      if (Object.keys(pending).length > 0)
        void window.cuedeck.updatePublicSettings(pending).catch(() => undefined);
    },
    [],
  );
  const slide = (patch: Partial<PublicSettings>) => {
    setSettings((current) => ({ ...current, ...patch }));
    slidePatch.current = { ...slidePatch.current, ...patch };
    window.clearTimeout(slideTimer.current);
    slideTimer.current = window.setTimeout(() => {
      const pending = slidePatch.current;
      slidePatch.current = {};
      void update(pending).catch(() => undefined);
    }, SLIDER_DEBOUNCE_MS);
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
            onChange={(e) => slide({ fontScale: Number(e.target.value) })}
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
            onChange={(e) => slide({ maxClipSeconds: Number(e.target.value) })}
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
