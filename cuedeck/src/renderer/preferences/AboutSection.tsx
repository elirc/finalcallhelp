import React, { useEffect, useState } from 'react';
import type { AppCapabilities } from '../../shared/domain';

export function AboutSection(): React.JSX.Element {
  const [capabilities, setCapabilities] = useState<AppCapabilities | null>(null);
  useEffect(() => {
    void window.cuedeck
      .getCapabilities()
      .then(setCapabilities)
      .catch(() => undefined);
  }, []);
  return (
    <>
      <h1>Privacy &amp; consent</h1>
      {capabilities && (
        <p className="hint">
          CueDeck {capabilities.appVersion} · Electron {capabilities.electronVersion} ·{' '}
          {capabilities.platform} {capabilities.osVersion}
        </p>
      )}
      <section className="card">
        <h2>Recording consent</h2>
        <p>
          You are responsible for obtaining participant consent and following the laws and rules
          that apply to your calls, interviews, and jurisdiction. CueDeck always shows a recording
          indicator while capture is active, never records automatically, and has no feature that
          hides it from screen sharing or recording.
        </p>
      </section>
      <section className="card">
        <h2>Permitted use</h2>
        <p>
          CueDeck is for mock interviews, rehearsal, accessibility support, and disclosed assistance
          on permitted calls. It is not for proctored assessments or any setting where outside help
          is prohibited. Responses are grounded in the profile you provide and the app instructs
          models never to invent experience.
        </p>
      </section>
      <section className="card">
        <h2>Where data lives</h2>
        <p>
          In local mode nothing leaves this computer. Optional cloud providers receive only the
          current clip or transcript plus your active profile and notes, and each shows its data-use
          policy before you enable it. History is off by default. There is no telemetry.
        </p>
      </section>
    </>
  );
}
