import { existsSync } from 'node:fs';
import path from 'node:path';
import { createRequire, builtinModules } from 'node:module';
import { spawnSync } from 'node:child_process';
import { build } from 'vite';

const project = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const output = path.join(project, 'tools', 'phone-photo-sync', 'catalog.cjs');
if (!existsSync(output) || process.argv.includes('--build')) {
  await build({ configFile: false, root: project, resolve: { conditions: ['node'], mainFields: ['module','jsnext:main','jsnext'] }, build: {
    outDir: path.dirname(output), emptyOutDir: false, lib: { entry: path.join(project,'scripts/phone-sync-catalog.ts'), formats: ['cjs'], fileName: () => 'catalog.cjs' },
    rollupOptions: { external: [...builtinModules,...builtinModules.map(name=>'node:'+name),'better-sqlite3','sqlite-vec','koffi','sharp','trash','exifr','@napi-rs/canvas'] },
  } });
}
const root = process.argv.slice(2).find(arg => arg !== '--build');
if (!root) process.exit(0);
const child = spawnSync(require('electron'), [output,root], { cwd: project, env: { ...process.env, ELECTRON_RUN_AS_NODE:'1' }, stdio:'inherit', windowsHide:true });
if (child.error) throw child.error;
process.exit(child.status ?? 1);
