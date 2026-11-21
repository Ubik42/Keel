import path from "node:path";

/**
 * Resolve the userData directory for `npm start`.
 *
 * The development build uses `<repo>/.local-profile` by default, so it never
 * reads or writes the installed release's settings and recent libraries.
 * An explicit absolute SERPENT_USER_DATA_PATH keeps priority.
 *
 * @param {string} projectRoot
 * @param {NodeJS.ProcessEnv} env
 * @returns {{ path: string, source: "env" | "default" }}
 */
export function resolveDevUserDataPath(projectRoot, env) {
  const configured = env.SERPENT_USER_DATA_PATH;
  if (configured && path.isAbsolute(configured)) {
    return { path: configured, source: "env" };
  }
  return { path: path.join(projectRoot, ".local-profile"), source: "default" };
}
