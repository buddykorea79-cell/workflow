export type HelpPreference = 'expanded' | 'collapsed' | 'dismissed';
export type HelpStorage = Pick<Storage, 'getItem' | 'setItem'>;
export type HelpStorageAccess = () => HelpStorage | undefined;

export const helpStorageKey = (userId: string, id: string) => `ieum.help.${userId}.${id}`;

/** Storage access itself may throw in private/restricted browser contexts. */
export function readHelpPreference(key: string, storage: HelpStorageAccess): HelpPreference {
  try {
    const value = storage()?.getItem(key);
    return value === 'collapsed' || value === 'dismissed' ? value : 'expanded';
  } catch { return 'expanded'; }
}

/** Persistence is optional; callers update their visible state before attempting it. */
export function writeHelpPreference(key: string, value: HelpPreference, storage: HelpStorageAccess): boolean {
  try {
    const target = storage();
    if (!target) return false;
    target.setItem(key, value);
    return true;
  } catch { return false; }
}
