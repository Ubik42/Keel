import path from 'node:path';

import { app } from 'electron';

import { MCP_LAUNCHER_FLAG } from './mcp-stdio-launcher';

/**
 * Main-process entry. `Keel.exe --mcp` runs only the stdio MCP launcher, so it
 * takes no single-instance lock and opens no window; every other launch loads
 * the desktop app.
 */
if (process.argv.includes(MCP_LAUNCHER_FLAG)) {
  const forkUserDataPath = process.env.KEEL_USER_DATA_PATH;
  const userDataPath = forkUserDataPath && path.isAbsolute(forkUserDataPath)
    ? forkUserDataPath
    : app.getPath('userData');
  void import('./mcp-stdio-launcher')
    .then(({ runMcpStdioLauncher }) => runMcpStdioLauncher({ userDataPath, executablePath: process.execPath }))
    .catch((error: unknown) => {
      process.stderr.write(`keel-mcp: ${error instanceof Error ? error.message : String(error)}\n`);
      app.exit(1);
    });
} else {
  void import('./index');
}
