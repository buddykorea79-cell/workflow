import packageInfo from '../../package.json';

/** Build version, independent of the workspace's editable release history. */
export const APP_VERSION: string = packageInfo.version;
