/**
 * P1 rename: environment variables moved from `SERPENT_*` to `KEEL_*`. Copy a
 * legacy value to its new name when the new one is unset, so old launchers,
 * shortcuts and scripts keep working. Child processes inherit the result.
 */
export function aliasLegacyEnvironment(env: NodeJS.ProcessEnv = process.env): void {
  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith('SERPENT_') || value === undefined) continue;
    const current = `KEEL_${name.slice('SERPENT_'.length)}`;
    if (env[current] === undefined) env[current] = value;
  }
}
