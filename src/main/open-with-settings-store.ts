import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  DEFAULT_OPEN_WITH_SETTINGS,
  parseOpenWithSettings,
  type OpenWithSettings,
} from '../shared/open-with';

export const OPEN_WITH_SETTINGS_FILE_NAME = 'open-with-settings.json';

export function openWithSettingsFilePath(userDataPath: string): string {
  return path.join(userDataPath, OPEN_WITH_SETTINGS_FILE_NAME);
}

export function readOpenWithSettings(filePath: string): OpenWithSettings {
  try {
    return parseOpenWithSettings(JSON.parse(readFileSync(filePath, 'utf8')));
  } catch {
    return DEFAULT_OPEN_WITH_SETTINGS;
  }
}

export function writeOpenWithSettings(filePath: string, settings: unknown): OpenWithSettings {
  const stored = parseOpenWithSettings(settings);
  writeFileSync(filePath, `${JSON.stringify(stored, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  return stored;
}
