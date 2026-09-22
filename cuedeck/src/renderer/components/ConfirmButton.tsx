import React, { useEffect, useState } from 'react';

/**
 * Two-step destructive button: the first click arms it and swaps the label
 * to a confirmation; the second click within a few seconds fires. Inline
 * (no modal), keyboard-reachable, and it disarms itself so a stray click
 * never leaves a live "confirm" button behind.
 */
export function ConfirmButton({
  label,
  confirmLabel,
  onConfirm,
  className = 'small danger',
  disabled,
  armMs = 4000,
  testId,
}: {
  label: string;
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
  className?: string;
  disabled?: boolean;
  armMs?: number;
  testId?: string;
}): React.JSX.Element {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), armMs);
    return () => window.clearTimeout(timer);
  }, [armed, armMs]);
  return (
    <button
      className={className}
      disabled={disabled}
      aria-live="polite"
      data-testid={testId}
      onClick={() => {
        if (!armed) {
          setArmed(true);
          return;
        }
        setArmed(false);
        void onConfirm();
      }}
    >
      {armed ? confirmLabel : label}
    </button>
  );
}
