import { describe, expect, it } from 'vitest';
import {
  normalizeOpenWithExtension,
  parseOpenWithSettings,
  resolveOpenWithTarget,
} from '../../src/shared/open-with';

const programId = '6b1e3c0a-9f2d-4c41-8a55-0d7a4e2b9c11';

describe('open-with settings', () => {
  it('resolves the default by extension and falls back to the Keel viewer', () => {
    const settings = parseOpenWithSettings({
      version: 1,
      programs: [{ programId, name: 'Panthesia', executablePath: 'C:\\Apps\\Panthesia.exe' }],
      defaults: { mid: { kind: 'program', programId }, pdf: { kind: 'system' } },
    });
    expect(resolveOpenWithTarget(settings, 'Song.MID')).toEqual({ kind: 'program', programId });
    expect(resolveOpenWithTarget(settings, 'doc.pdf')).toEqual({ kind: 'system' });
    expect(resolveOpenWithTarget(settings, 'photo.png')).toEqual({ kind: 'viewer' });
    expect(resolveOpenWithTarget(settings, 'README')).toEqual({ kind: 'viewer' });
  });

  it('drops defaults that point at a removed program and rejects malformed input', () => {
    const settings = parseOpenWithSettings({
      version: 1,
      programs: [],
      defaults: { mid: { kind: 'program', programId } },
    });
    expect(settings.defaults).toEqual({});
    expect(parseOpenWithSettings({ version: 2 })).toEqual({ version: 1, programs: [], defaults: {} });
  });

  it('normalizes extensions typed by the user', () => {
    expect(normalizeOpenWithExtension(' .MID ')).toBe('mid');
    expect(normalizeOpenWithExtension('tar.gz')).toBe('tar.gz');
    expect(normalizeOpenWithExtension('a b')).toBeNull();
    expect(normalizeOpenWithExtension('')).toBeNull();
  });
});
