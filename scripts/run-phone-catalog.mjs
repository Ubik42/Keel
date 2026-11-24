import { existsSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { createRequire, builtinModules } from 'node:module';
import { spawnSync } from 'node:child_process';
import { build } from 'vite';

const project = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const output = path.join(project, 'tools', 'phone-photo-sync', 'catalog.cjs');
const buildKeyPath = path.join(path.dirname(output), '.catalog-build-key');
const buildKey = JSON.stringify({
  version: JSON.parse(readFileSync(path.join(project, 'package.json'), 'utf8')).version,
  sources: ['src/worker/library-service.ts', 'src/shared/automatic-tasks.ts', 'scripts/phone-sync-catalog.ts'].map((source) => {
    const stat = statSync(path.join(project, source));
    return [source, stat.mtimeMs, stat.size];
  }),
});
let previousBuildKey = '';
try { previousBuildKey = readFileSync(buildKeyPath, 'utf8'); } catch { /* First run or cleared cache. */ }
if (!existsSync(output) || previousBuildKey !== buildKey || process.argv.includes('--build')) {
  await build({ configFile: false, root: project, resolve: { conditions: ['node'], mainFields: ['module','jsnext:main','jsnext'] }, build: {
    outDir: path.dirname(output), emptyOutDir: false, lib: { entry: path.join(project,'scripts/phone-sync-catalog.ts'), formats: ['cjs'], fileName: () => 'catalog.cjs' },
    rollupOptions: { external: [...builtinModules,...builtinModules.map(name=>'node:'+name),'better-sqlite3','sqlite-vec','koffi','sharp','trash','exifr','@napi-rs/canvas'] },
  } });
  writeFileSync(buildKeyPath, buildKey);
}
const args = process.argv.slice(2).filter(arg => arg !== '--build');
if (!args.length) process.exit(0);
const child = spawnSync(require('electron'), [output,...args],{ cwd: project, env: { ...process.env, ELECTRON_RUN_AS_NODE:'1' }, stdio:'inherit', windowsHide:true });
if (child.error) throw child.error;
process.exit(child.status ?? 1);
