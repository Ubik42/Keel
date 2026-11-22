import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { copyLegacyUserData } from '../../../src/main/app/legacy-user-data';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function appData() {
  const root = mkdtempSync(path.join(tmpdir(), 'keel-user-data-'));
  roots.push(root);
  const legacy = path.join(root, 'Serpent');
  mkdirSync(path.join(legacy, 'Local Storage', 'leveldb'), { recursive: true });
  mkdirSync(path.join(legacy, 'Cache'), { recursive: true });
  writeFileSync(path.join(legacy, 'recent-library.json'), '{"x":1}');
  writeFileSync(path.join(legacy, 'Local Storage', 'leveldb', '000001.log'), 'prefs');
  writeFileSync(path.join(legacy, 'Cache', 'data_0'), 'cache');
  return { root, legacy, current: path.join(root, 'Keel') };
}

describe('copyLegacyUserData', () => {
  it('copies settings and local storage but skips caches, and leaves the old profile', () => {
    const { root, legacy, current } = appData();
    mkdirSync(path.join(current, 'Crashpad'), { recursive: true });
    const result = copyLegacyUserData({ appDataPath: root, userDataPath: current });
    expect(result.status).toBe('copied');
    expect(readFileSync(path.join(current, 'recent-library.json'), 'utf8')).toBe('{"x":1}');
    expect(readFileSync(path.join(current, 'Local Storage', 'leveldb', '000001.log'), 'utf8')).toBe('prefs');
    expect(existsSync(path.join(current, 'Cache'))).toBe(false);
    expect(existsSync(path.join(legacy, 'recent-library.json'))).toBe(true);
  });

  it('does nothing once the Keel profile has its own data', () => {
    const { root, current } = appData();
    mkdirSync(current, { recursive: true });
    writeFileSync(path.join(current, 'recent-library.json'), '{"keel":true}');
    expect(copyLegacyUserData({ appDataPath: root, userDataPath: current }).status).toBe('skipped');
    expect(readFileSync(path.join(current, 'recent-library.json'), 'utf8')).toBe('{"keel":true}');
  });
});
