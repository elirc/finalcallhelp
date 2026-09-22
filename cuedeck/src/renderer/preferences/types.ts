import type { PublicSettings } from '../../shared/domain';

export interface SectionProps {
  settings: PublicSettings;
  onSettingsChanged: () => Promise<void>;
}
