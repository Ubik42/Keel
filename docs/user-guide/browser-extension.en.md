# Browser extension

Save web images or videos into a Keel library with **context-menu saving** and **drag-and-drop saving**. Supports Chrome / Edge (Chromium) and Firefox.

Media is downloaded by the **browser** (with cookies and the page Referer) and uploaded to the local Keel app, bypassing most hotlink protections. Keep Keel running with a library open — the extension connects to `127.0.0.1` only; there is no remote server.

## Installation

> The extension is not on a browser store yet; install it manually. Download it from the [extension releases](https://github.com/Ubik42/Keel/releases?q=extension) of the Keel repository; packaged Keel desktop builds also include a copy in `resources/extension` inside the program folder.

### Chrome / Edge

1. Download `keel-extension-<version>.zip` from the [extension releases](https://github.com/Ubik42/Keel/releases?q=extension) and extract it to a fixed folder (e.g. `Documents/Keel-extension`). The folder must directly contain `manifest.json`.
2. Open `chrome://extensions` (Edge: `edge://extensions`) and turn on Developer mode in the top-right corner.
3. Click "Load unpacked" and choose the extracted folder.

### Firefox

There is no Mozilla-signed `.xpi` of the Keel extension yet. In `about:debugging` → "This Firefox" → "Load Temporary Add-on", choose `manifest.json` in the extracted folder; a temporary add-on is removed when Firefox restarts.

### Updating

Download the new zip from the releases page → extract over the old folder → click "Reload" on the extension card in `chrome://extensions` (or remove and load it again).

## Usage

1. Start Keel and open a library.
2. The extension toolbar icon turns **colored** when connected and stays **gray** when not.
3. **Context-menu save**: right-click an image or video on a web page → “Save to Keel” → choose a target folder (recent saves/browses → separator → root → top-level folders; subfolders expand level by level).
4. **Drag-and-drop save**: drag an image and a tree-shaped save menu opens — hover `›` on a folder with children to enter its level, `‹` to go back, release outside the panel or press `Esc` to cancel.
5. A “Saving to Keel” bubble shows progress on the page.

### Options page

Right-click the extension icon → Options to toggle:

- Notifications (system notification for save results)
- Focus Keel after saving
- Reveal the saved asset in the library
- The drag-and-drop tree menu on web images/videos

## Troubleshooting

**“Cannot connect to Keel”**

Make sure Keel is running with a library open. Gray icon = disconnected; colored = connected.

**“forbidden origin” (403) when saving**

Older extension builds hit this (the server only allowed Chrome extension origins). Update to 0.1.1 or newer — Firefox’s `moz-extension://` origins are now accepted.

**The saved image is not visible in the library**

Check the “Reveal in library” option in the extension options page, and confirm the target folder you chose.

**Firefox says “This add-on could not be installed because it appears to be corrupt” / “not verified”**

You installed an unsigned zip. Use the **`-signed.xpi`** file from the releases page.

**Does the extension access all websites? Is it safe?**

The extension requests “access to all websites” — required to save images/videos from any page. It only connects to the local Keel app (`127.0.0.1`, fixed ports) and never sends data to remote servers. The code is open source (MIT).

## Privacy

- The extension does not collect or upload any personal data.
- Saves are initiated by you; media files are uploaded directly to your local Keel app.
- The only stored record (recently used folders) lives in the browser’s local `storage`.
