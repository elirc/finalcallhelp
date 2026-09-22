import { useCallback, useEffect, useState } from 'react';
import type { Profile } from '../../shared/domain';

/**
 * Profile list for a window. There is no push event for profile edits, so
 * the list refreshes on mount, whenever public settings change (a save in
 * Preferences usually comes with an `activeProfileId` patch), and when the
 * window regains focus after the user has been in the other window.
 */
export function useProfiles(dependencyKey: string): {
  profiles: Profile[];
  refresh: () => Promise<void>;
} {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const refresh = useCallback(async () => {
    const list = await window.cuedeck.listProfiles().catch(() => null);
    if (list) setProfiles(list);
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh, dependencyKey]);
  useEffect(() => {
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);
  return { profiles, refresh };
}
