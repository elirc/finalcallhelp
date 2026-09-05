import React, { useEffect, useState } from 'react';
import type { PublicSettings } from '../shared/domain';
import { errorMessage } from '../shared/setup';
import { Coach } from './routes/Coach';
import { Onboarding } from './routes/Onboarding';
import { Preferences } from './routes/Preferences';

function useHashRoute(): string {
  const [route, setRoute] = useState(() => window.location.hash.replace(/^#/, '') || '/');
  useEffect(() => {
    const onChange = () => setRoute(window.location.hash.replace(/^#/, '') || '/');
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export function App(): React.JSX.Element {
  const route = useHashRoute();
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [error, setError] = useState('');

  const applySettings = (s: PublicSettings) => {
    setSettings(s);
    document.documentElement.style.setProperty('--font-scale', String(s.fontScale));
  };

  const refresh = async () => {
    applySettings(await window.cuedeck.getPublicSettings());
  };

  useEffect(() => {
    const onRejection = (event: PromiseRejectionEvent) => {
      event.preventDefault();
      setError(errorMessage(event.reason));
    };
    window.addEventListener('unhandledrejection', onRejection);
    if (!window.cuedeck) {
      setError(
        'CueDeck needs its desktop window. Start the app with npm start from the cuedeck folder.',
      );
      return () => window.removeEventListener('unhandledrejection', onRejection);
    }
    const unsubscribe = window.cuedeck.onSettingsChanged(applySettings);
    void refresh().catch((err: unknown) => setError(errorMessage(err)));
    return () => {
      unsubscribe();
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  return (
    <>
      {error && (
        <div className="error-banner" role="alert">
          {error}{' '}
          <button
            className="small"
            onClick={() => {
              setError('');
              if (!settings && window.cuedeck) void refresh();
            }}
          >
            Dismiss / retry
          </button>
        </div>
      )}
      {!settings ? (
        <div className="onboarding">{error ? 'Unable to load CueDeck.' : 'Loading…'}</div>
      ) : route.startsWith('/preferences') ? (
        <Preferences settings={settings} onSettingsChanged={refresh} />
      ) : !settings.onboardingComplete ? (
        <Onboarding settings={settings} onSettingsChanged={refresh} />
      ) : (
        <Coach settings={settings} onSettingsChanged={refresh} />
      )}
    </>
  );
}
