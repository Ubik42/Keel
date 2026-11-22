

/**
 * Platform key used to check plugin compatibility (split out of index.ts, P8).
 */
export function currentPluginCompatibilityPlatform():
  | { platform: 'darwin' | 'win32' | 'linux'; arch: 'arm64' | 'x64' | 'ia32' }
  | undefined {
  const platform = process.platform;
  const arch = process.arch;
  if ((platform !== 'darwin' && platform !== 'win32' && platform !== 'linux')
    || (arch !== 'arm64' && arch !== 'x64' && arch !== 'ia32')) {
    return undefined;
  }
  return { platform, arch };
}
