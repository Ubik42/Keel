import { ipcRenderer } from 'electron';

import {
  OPEN_WITH_CHOOSE_PROGRAM_CHANNEL,
  OPEN_WITH_SETTINGS_GET_CHANNEL,
  OPEN_WITH_SETTINGS_SET_CHANNEL,
} from '../../shared/protocol/channels';
import { parseOpenWithSettings, type OpenWithSettings } from '../../shared/open-with';

export type KeelOpenWithApi = {
  get(): Promise<OpenWithSettings>;
  set(settings: OpenWithSettings): Promise<OpenWithSettings>;
  /** Native picker; null when cancelled. */
  chooseProgram(): Promise<{ name: string; executablePath: string } | null>;
};

export const openWith: KeelOpenWithApi = Object.freeze({
  async get() {
    return parseOpenWithSettings(await ipcRenderer.invoke(OPEN_WITH_SETTINGS_GET_CHANNEL));
  },
  async set(settings) {
    return parseOpenWithSettings(await ipcRenderer.invoke(OPEN_WITH_SETTINGS_SET_CHANNEL, settings));
  },
  async chooseProgram() {
    const value = (await ipcRenderer.invoke(OPEN_WITH_CHOOSE_PROGRAM_CHANNEL)) as unknown;
    if (!value || typeof value !== 'object') return null;
    const { name, executablePath } = value as { name?: unknown; executablePath?: unknown };
    return typeof name === 'string' && typeof executablePath === 'string' ? { name, executablePath } : null;
  },
});
