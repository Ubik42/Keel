import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { isKeelDevElectronCommand } from '../../scripts/kill-stale-dev.mjs';

const root = path.win32.join('fixture', 'Keel');
const ownExecutable = path.win32.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');

test('Windows dev cleanup matches only this checkout Electron binary', () => {
  assert.equal(isKeelDevElectronCommand(`"${ownExecutable}" .`, root), true);
  assert.equal(isKeelDevElectronCommand(`${ownExecutable} . --type=renderer`, root), true);
  assert.equal(isKeelDevElectronCommand('"fixture\\Other\\electron.exe" .', root), false);
  assert.equal(isKeelDevElectronCommand(`"${ownExecutable}.bak" .`, root), false);
  assert.equal(isKeelDevElectronCommand(null, root), false);
});

test('E2E guard also recognizes only this checkout on macOS and Linux', () => {
  const posixRoot = 'fixture/Serpent';
  assert.equal(isKeelDevElectronCommand(
    'fixture/Serpent/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron .',
    posixRoot, 'darwin',
  ), true);
  assert.equal(isKeelDevElectronCommand(
    'fixture/Serpent/node_modules/electron/dist/electron .', posixRoot, 'linux',
  ), true);
  assert.equal(isKeelDevElectronCommand(
    'fixture/Other/node_modules/electron/dist/electron .', posixRoot, 'linux',
  ), false);
});
