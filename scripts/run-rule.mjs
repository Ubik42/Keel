#!/usr/bin/env node
/**
 * Development entry for the rule command line: runs the packaged dev build
 * (out/Keel-win32-x64/Keel.exe) with `--rule …` and the dev profile, and
 * forwards its output. A GUI-subsystem Keel.exe started straight from a
 * console prints nothing there; through this script (or any pipe) it does.
 *
 *   node scripts/run-rule.mjs list
 *   node scripts/run-rule.mjs dry-run <rule-id> --library 美术
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { resolveDevUserDataPath } from './dev-profile.mjs';

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const executable = process.env.KEEL_EXECUTABLE ?? path.join(projectRoot, 'out', 'Keel-win32-x64', 'Keel.exe');
if (!existsSync(executable)) {
  process.stderr.write(`Build the application first (npm run package), or set KEEL_EXECUTABLE: ${executable}\n`);
  process.exit(1);
}

const env = { ...process.env, KEEL_USER_DATA_PATH: resolveDevUserDataPath(projectRoot, process.env).path };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(executable, ['--rule', ...process.argv.slice(2)], { env, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);
child.on('error', (error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
child.on('exit', (code) => process.exit(code ?? 1));
