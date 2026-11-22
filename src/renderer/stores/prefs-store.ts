import type { SetStateAction } from 'react';
import { create } from 'zustand';

import { loadAiUiPreferences, saveAiUiPreferences, type AiUiPreferences } from '../ai-ui-preferences';
import { loadAudioPreviewPreferences, saveAudioPreviewPreferences } from '../audio-preview-preferences';
import { loadCanvasPreferences, saveCanvasPreferences, type CanvasPreferences } from '../canvas-preferences';
import { loadImageRotationPreferences, saveImageRotationPreferences } from '../image-rotation-preferences';
import {
  loadImageSequencePreferences,
  saveImageSequencePreferences,
  type ImageSequencePreferences,
} from '../image-sequence-preferences';
import {
  loadViewerChromePreferences,
  saveViewerChromePreferences,
  type ViewerChromePreferences,
} from '../viewer-chrome-preferences';

/**
 * Appearance and browse preferences (docs/进度.md 3.2 `prefs`). Each setter
 * accepts a value or an updater, like a React state setter, and saves the
 * result to local storage.
 */
export interface PrefsState {
  canvas: CanvasPreferences;
  aiUi: AiUiPreferences;
  imageSequence: ImageSequencePreferences;
  viewerChrome: ViewerChromePreferences;
  audioPreviewPrefersCover: boolean;
  bakeImageRotation: boolean;
  setCanvas: (action: SetStateAction<CanvasPreferences>) => void;
  setAiUi: (action: SetStateAction<AiUiPreferences>) => void;
  setImageSequence: (action: SetStateAction<ImageSequencePreferences>) => void;
  setViewerChrome: (action: SetStateAction<ViewerChromePreferences>) => void;
  setAudioPreviewPrefersCover: (preferCover: boolean) => void;
  setBakeImageRotation: (bakeIntoFile: boolean) => void;
}

function resolve<T>(action: SetStateAction<T>, previous: T): T {
  return typeof action === 'function' ? (action as (value: T) => T)(previous) : action;
}

export const usePrefsStore = create<PrefsState>()((set, get) => {
  function updater<K extends 'canvas' | 'aiUi' | 'imageSequence' | 'viewerChrome'>(
    key: K,
    save: (value: PrefsState[K]) => void,
  ) {
    return (action: SetStateAction<PrefsState[K]>) => {
      const previous = get()[key];
      const next = resolve(action, previous);
      if (Object.is(next, previous)) return;
      save(next);
      set({ [key]: next } as Pick<PrefsState, K>);
    };
  }
  return {
    canvas: loadCanvasPreferences(),
    aiUi: loadAiUiPreferences(),
    imageSequence: loadImageSequencePreferences(),
    viewerChrome: loadViewerChromePreferences(),
    audioPreviewPrefersCover: loadAudioPreviewPreferences().preferCover,
    bakeImageRotation: loadImageRotationPreferences().bakeIntoFile,
    setCanvas: updater('canvas', (value) => saveCanvasPreferences(value)),
    setAiUi: updater('aiUi', (value) => saveAiUiPreferences(value)),
    setImageSequence: updater('imageSequence', (value) => saveImageSequencePreferences(value)),
    setViewerChrome: updater('viewerChrome', (value) => saveViewerChromePreferences(value)),
    setAudioPreviewPrefersCover: (preferCover) => {
      saveAudioPreviewPreferences({ version: 1, preferCover });
      set({ audioPreviewPrefersCover: preferCover });
    },
    setBakeImageRotation: (bakeIntoFile) => {
      saveImageRotationPreferences({ version: 1, bakeIntoFile });
      set({ bakeImageRotation: bakeIntoFile });
    },
  };
});
