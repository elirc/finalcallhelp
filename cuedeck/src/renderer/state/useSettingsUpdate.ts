import { useCallback } from 'react';
import type { PublicSettings } from '../../shared/domain';

/**
 * The one way renderer code writes public settings: patch through the
 * preload API, then let the caller refresh its snapshot. Every route used
 * to hand-roll this pair; keeping it in one hook means a future change
 * (optimistic updates, error toasts) lands everywhere at once.
 */
export function useSettingsUpdate(onSettingsChanged: () => Promise<void>) {
  return useCallback(
    async (patch: Partial<PublicSettings>) => {
      await window.cuedeck.updatePublicSettings(patch);
      await onSettingsChanged();
    },
    [onSettingsChanged],
  );
}
