import { closeSync, copyFileSync, existsSync, ftruncateSync, lstatSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import type * as Koffi from 'koffi';
import { libraryMetaDir } from '../../shared/library-meta-dir';

function decodeIni(bytes: Buffer): string {
  return bytes[0] === 0xff && bytes[1] === 0xfe
    ? bytes.subarray(2).toString('utf16le')
    : bytes.toString('utf8').replace(/^\uFEFF/, '');
}

/** Give writable Windows libraries a portable Explorer icon. Source media is untouched. */
export function ensureWindowsLibraryIcon(libraryPath: string): boolean {
  if (process.platform !== 'win32') return false;
  const metadataPath = libraryMetaDir(libraryPath);
  const desktopPath = path.join(libraryPath, 'desktop.ini');
  const iconPath = path.join(metadataPath, 'library.ico');
  if (!existsSync(metadataPath) || lstatSync(metadataPath).isSymbolicLink()) return false;
  for (const filename of [desktopPath, iconPath]) {
    if (existsSync(filename) && (!lstatSync(filename).isFile() || lstatSync(filename).isSymbolicLink())) return false;
  }
  const sourceIcon = [
    ...(process.resourcesPath ? [path.join(process.resourcesPath, 'app.ico')] : []),
    path.join(process.cwd(), 'assets', 'icons', 'app.ico'),
  ].find((filename) => existsSync(filename));
  if (!sourceIcon) return false;
  const icon = readFileSync(sourceIcon);
  if (!existsSync(iconPath) || !readFileSync(iconPath).equals(icon)) writeFileSync(iconPath, icon);
  const previous = existsSync(desktopPath) ? readFileSync(desktopPath) : Buffer.alloc(0);
  const original = decodeIni(previous);
  const desiredIcon = `IconResource=${path.basename(metadataPath)}\\library.ico,0`;
  const lines = original.split(/\r?\n/);
  const output: string[] = [];
  let inShell = false;
  let foundShell = false;
  for (const line of lines) {
    if (/^\s*\[.*\]\s*$/.test(line)) {
      inShell = /^\s*\[\.ShellClassInfo\]\s*$/i.test(line);
      if (inShell) { foundShell = true; output.push(line, desiredIcon); continue; }
    }
    if (inShell && /^\s*(IconResource|IconFile|IconIndex)\s*=/i.test(line)) continue;
    output.push(line);
  }
  if (!foundShell) output.unshift('[.ShellClassInfo]', desiredIcon);
  const text = output.join('\r\n').replace(/(?:\r\n)*$/, '\r\n');
  if (text !== original) {
    // Name kept from before the rename so an existing backup is never replaced.
    const backupPath = path.join(metadataPath, 'desktop.ini.before-serpent');
    if (previous.length && !existsSync(backupPath)) copyFileSync(desktopPath, backupPath);
    const bytes = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
    // OPEN_EXISTING can update hidden/system files; CREATE_ALWAYS fails on Billfish's desktop.ini.
    const fd = openSync(desktopPath, existsSync(desktopPath) ? 'r+' : 'wx');
    try { writeFileSync(fd, bytes); ftruncateSync(fd, bytes.length); }
    finally { closeSync(fd); }
  }
  execFileSync('attrib.exe', ['+h', '+s', desktopPath], { windowsHide: true, timeout: 3000 });
  execFileSync('attrib.exe', ['+s', libraryPath], { windowsHide: true, timeout: 3000 });
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const koffi = require('koffi') as typeof Koffi;
    const notify = koffi.load('shell32.dll').func('void SHChangeNotify(long eventId, uint32 flags, str16 item1, void *item2)');
    notify(0x2000, 0x0005, libraryPath, null);
  } catch { /* Explorer will also pick up desktop.ini when the folder is refreshed. */ }
  return true;
}
