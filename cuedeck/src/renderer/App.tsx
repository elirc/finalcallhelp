import React, { Suspense, useCallback, useEffect, useState } from 'react';
import type { PublicSettings } from '../shared/domain';
import { errorMessage } from '../shared/setup';
import { Coach } from './routes/Coach';

// The coach window never renders these after first run, and the preferences
// window never renders the coach: code-splitting keeps each window's initial
// parse to what it actually shows.
const Onboarding = React.lazy(() =>
  import('./routes/Onboarding').then((m) => ({ default: m.Onboarding })),
);
const Preferences = React.lazy(() =>
  import('./routes/Preferences').then((m) => ({ default: m.Preferences })),
);

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

  // Stable identity: child effects depend on this callback, and a new
  // function every render would re-run them (and their IPC calls) each time.
  const refresh = useCallback(async () => {
    applySettings(await window.cuedeck.getPublicSettings());
  }, []);

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
  }, [refresh]);

  const loading = (
    <div className="onboarding">{error ? 'Unable to load CueDeck.' : 'Loading…'}</div>
  );

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
        loading
      ) : route.startsWith('/preferences') ? (
        <Suspense fallback={loading}>
          <Preferences
            settings={settings}
            onSettingsChanged={refresh}
            initialSection={route.split('/')[2]}
          />
        </Suspense>
      ) : !settings.onboardingComplete ? (
        <Suspense fallback={loading}>
          <Onboarding settings={settings} onSettingsChanged={refresh} />
        </Suspense>
      ) : (
        <Coach settings={settings} onSettingsChanged={refresh} />
      )}
    </>
  );
}
