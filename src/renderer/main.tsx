import './migrate-legacy-storage';
import { applyInterfaceScale, loadInterfaceScale } from './interface-scale';
import '@fontsource-variable/noto-sans-sc/index.css';
// Windows-only HarmonyOS face; vite aliases this to an empty stub on macOS/Linux
// so darwin npm start does not require harmonyos-sans-sc-webfont-splitted.
import './harmonyos-sans-sc-windows.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { installImeCompositionGuard } from './workbench/overlay/ime-safe-dismiss';
import { ElevationProvider } from './ElevationProvider';
import { FontSizeProvider } from './FontSizeProvider';
import { InspectorCardFeelProvider } from './InspectorCardFeelProvider';
import { LocaleProvider } from './i18n';
import { MenuAcrylicProvider } from './MenuAcrylicProvider';
import { RadiusProvider } from './RadiusProvider';
import { ShortcutProvider } from './workbench/shortcuts/shortcut-provider';
import { applyRendererPlatform } from './renderer-platform';
import {
  applyMenuAcrylicPreferences,
  loadMenuAcrylicPreferences,
} from './menu-acrylic-preferences';
import {
  applyRadiusPreferences,
  loadRadiusPreferences,
} from './radius-preferences';
import {
  applyShadowPreferences,
  loadShadowPreferences,
} from './shadow-preferences';
import { ThemeProvider } from './theme';
import {
  applyFontSizePreferences,
  loadFontSizePreferences,
} from './font-size-preferences';
import './styles.css';
import './workbench/ui/tokens.css';
import './workbench/ui/ui.css';
import './workbench/ui/islands-surfaces.css';

applyRendererPlatform(document.documentElement, navigator.userAgent);
installImeCompositionGuard();
// Apply elev level before first paint so level 0 never flashes shell shadows.
applyShadowPreferences(loadShadowPreferences());
// Apply menu acrylic before first paint so the shared context-menu surface does
// not flash from the opaque default while React providers mount.
applyMenuAcrylicPreferences(loadMenuAcrylicPreferences());
applyRadiusPreferences(loadRadiusPreferences());
// Apply the user's typography scale before React mounts to avoid a default-size
// flash. This is app typography, separate from OS/Chromium display scaling.
applyFontSizePreferences(loadFontSizePreferences());
applyInterfaceScale(loadInterfaceScale());

const root = document.getElementById('root');

if (!root) {
  throw new Error('Renderer root element is missing.');
}

createRoot(root).render(
  <StrictMode>
    <LocaleProvider>
      <FontSizeProvider>
        <ThemeProvider>
          <ElevationProvider>
            <RadiusProvider>
              <MenuAcrylicProvider>
                <InspectorCardFeelProvider>
                  <ShortcutProvider>
                    <App />
                  </ShortcutProvider>
                </InspectorCardFeelProvider>
              </MenuAcrylicProvider>
            </RadiusProvider>
          </ElevationProvider>
        </ThemeProvider>
      </FontSizeProvider>
    </LocaleProvider>
  </StrictMode>,
);
