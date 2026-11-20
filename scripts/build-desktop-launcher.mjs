import path from 'node:path';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

if (process.platform === 'win32') {
  const root = path.resolve(import.meta.dirname, '..');
  const compiler = path.join(process.env.WINDIR ?? 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  if (!existsSync(compiler)) throw new Error('Windows .NET Framework compiler is unavailable.');
  const result = spawnSync(compiler, [
    '/nologo', '/target:winexe', '/codepage:65001', '/reference:System.Windows.Forms.dll',
    `/win32icon:${path.join(root, 'assets', 'icons', 'app.ico')}`,
    `/out:${path.join(root, 'Start-Serpent.exe')}`,
    path.join(root, 'tools', 'desktop-launcher', 'Launcher.cs'),
  ], { cwd: root, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('Serpent desktop launcher compilation failed.');
  process.stdout.write('Built console-free Start-Serpent.exe\n');
}
