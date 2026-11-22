/**
 * Privileges for the `keel://` artifact / source media scheme.
 *
 * Must be registered via `protocol.registerSchemesAsPrivileged` before
 * `app.ready`. `stream: true` is required so `<video>` / `<audio>` treat
 * Range responses as a streaming transport; without it Chromium buffers as if
 * the body were a single download, and seek/scrub against `createArtifactResponse`
 * frequently surfaces MEDIA_ERR_NETWORK / decode failures (Serpent-jh2).
 */
export const KEEL_PROTOCOL_SCHEME = "keel" as const;
export const KEEL_PLUGIN_PROTOCOL_SCHEME = "keel-plugin" as const;

export const KEEL_PROTOCOL_PRIVILEGES = {
  standard: true,
  secure: true,
  supportFetchAPI: true,
  stream: true,
  corsEnabled: true,
} as const;

export function keelProtocolSchemes() {
  return [
    {
      scheme: KEEL_PROTOCOL_SCHEME,
      privileges: { ...KEEL_PROTOCOL_PRIVILEGES },
    },
    {
      scheme: KEEL_PLUGIN_PROTOCOL_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        corsEnabled: true,
      },
    },
  ];
}

/** Pre-rename scheme names, served as aliases for one release cycle. */
export const LEGACY_PROTOCOL_SCHEMES: Readonly<Record<string, string>> = {
  [KEEL_PROTOCOL_SCHEME]: "serpent",
  [KEEL_PLUGIN_PROTOCOL_SCHEME]: "serpent-plugin",
};

export function legacyProtocolSchemes() {
  return keelProtocolSchemes().map((entry) => ({
    ...entry,
    scheme: LEGACY_PROTOCOL_SCHEMES[entry.scheme]!,
  }));
}

type ProtocolHandler = (request: Request) => Response | Promise<Response>;

/** Register `scheme` and its legacy alias; alias URLs are rewritten to `scheme`. */
export function handleProtocolWithLegacyAlias(
  protocolApi: { handle(scheme: string, handler: ProtocolHandler): void },
  scheme: string,
  handler: ProtocolHandler,
): void {
  protocolApi.handle(scheme, handler);
  const legacy = LEGACY_PROTOCOL_SCHEMES[scheme];
  if (legacy === undefined) return;
  protocolApi.handle(legacy, (request) => {
    const url = `${scheme}:${request.url.slice(legacy.length + 1)}`;
    const init: RequestInit & { duplex?: "half" } = { method: request.method, headers: request.headers };
    if (request.method !== "GET" && request.method !== "HEAD" && request.body !== null) {
      init.body = request.body;
      init.duplex = "half";
    }
    return handler(new Request(url, init));
  });
}
