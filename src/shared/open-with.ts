import { z } from 'zod';

/**
 * PF: how a file opens on double-click and in the "打开方式" menu. Defaults
 * are keyed by extension (lowercase, no dot). Programs are registered once
 * and referenced by id, so the renderer never passes an executable path to
 * Main when it asks to open a file.
 */
export const OPEN_WITH_SETTINGS_VERSION = 1 as const;

const extensionSchema = z.string().regex(/^[a-z0-9][a-z0-9_.-]{0,31}$/u);

export const openWithTargetSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('viewer') }),
  z.strictObject({ kind: z.literal('system') }),
  z.strictObject({ kind: z.literal('program'), programId: z.string().uuid() }),
  /** A plugin's asset menu item in the "open" group (e.g. "用 Panthesia 练习"). */
  z.strictObject({
    kind: z.literal('plugin'),
    pluginId: z.string().min(1).max(256),
    contributionId: z.string().min(1).max(512),
    itemId: z.string().min(1).max(512),
    label: z.string().trim().min(1).max(200),
  }),
]);
export type OpenWithTarget = z.infer<typeof openWithTargetSchema>;

export const openWithProgramSchema = z.strictObject({
  programId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  executablePath: z.string().min(1).max(4096),
});
export type OpenWithProgram = z.infer<typeof openWithProgramSchema>;

export const openWithSettingsSchema = z.strictObject({
  version: z.literal(OPEN_WITH_SETTINGS_VERSION),
  programs: z.array(openWithProgramSchema).max(64),
  defaults: z.record(extensionSchema, openWithTargetSchema),
});
export type OpenWithSettings = z.infer<typeof openWithSettingsSchema>;

export const DEFAULT_OPEN_WITH_SETTINGS: OpenWithSettings = {
  version: OPEN_WITH_SETTINGS_VERSION,
  programs: [],
  defaults: {},
};

export function normalizeOpenWithExtension(value: string): string | null {
  const normalized = value.trim().replace(/^\.+/u, '').toLowerCase();
  return extensionSchema.safeParse(normalized).success ? normalized : null;
}

/** Drop defaults that point at a removed program, so a stale id never reaches Main. */
export function parseOpenWithSettings(input: unknown): OpenWithSettings {
  const parsed = openWithSettingsSchema.safeParse(input);
  if (!parsed.success) return DEFAULT_OPEN_WITH_SETTINGS;
  const programIds = new Set(parsed.data.programs.map((program) => program.programId));
  const defaults: Record<string, OpenWithTarget> = {};
  for (const [extension, target] of Object.entries(parsed.data.defaults)) {
    if (target.kind === 'program' && !programIds.has(target.programId)) continue;
    defaults[extension] = target;
  }
  return { ...parsed.data, defaults };
}

/** Default target for a file name; unknown extensions open in the Keel viewer. */
export function resolveOpenWithTarget(settings: OpenWithSettings, fileName: string): OpenWithTarget {
  const dot = fileName.lastIndexOf('.');
  const extension = dot > 0 ? fileName.slice(dot + 1).toLowerCase() : '';
  return settings.defaults[extension] ?? { kind: 'viewer' };
}
