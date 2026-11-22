import { writeSync } from 'node:fs';
import path from 'node:path';

import { app } from 'electron';

import { MCP_LAUNCHER_FLAG } from './mcp/mcp-stdio-launcher';

/** `Keel.exe --rule <command>`: the rule tools on the command line (rule-cli.ts). */
const RULE_CLI_FLAG = '--rule';

function userDataPath(): string {
  const forkUserDataPath = process.env.KEEL_USER_DATA_PATH;
  return forkUserDataPath && path.isAbsolute(forkUserDataPath)
    ? forkUserDataPath
    : app.getPath('userData');
}

/**
 * Main-process entry. `Keel.exe --mcp` runs only the stdio MCP launcher and
 * `Keel.exe --rule …` only the rule command line; neither takes the
 * single-instance lock or opens a window. Every other launch loads the
 * desktop app.
 */
if (process.argv.includes(MCP_LAUNCHER_FLAG)) {
  void import('./mcp/mcp-stdio-launcher')
    .then(({ runMcpStdioLauncher }) => runMcpStdioLauncher({ userDataPath: userDataPath(), executablePath: process.execPath }))
    .catch((error: unknown) => {
      process.stderr.write(`keel-mcp: ${error instanceof Error ? error.message : String(error)}\n`);
      app.exit(1);
    });
} else if (process.argv.includes(RULE_CLI_FLAG)) {
  void import('./automation/rule-cli')
    .then(({ runRuleCli }) => runRuleCli({ argv: process.argv, userDataPath: userDataPath(), executablePath: process.execPath }))
    .then((code) => app.exit(code))
    .catch((error: unknown) => {
      // Electron's process.stderr does not reach a pipe on Windows; write the fd.
      writeSync(2, `keel-rule: ${error instanceof Error ? error.message : String(error)}\n`);
      app.exit(1);
    });
} else {
  void import('./index');
}
