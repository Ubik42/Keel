import { describe, expect, it } from "vitest";

import {
  KEEL_PROTOCOL_PRIVILEGES,
  KEEL_PROTOCOL_SCHEME,
  KEEL_PLUGIN_PROTOCOL_SCHEME,
  serpentProtocolSchemes,
} from "../../src/main/serpent-protocol-privileges";

describe("serpent protocol privileges", () => {
  it("enables streaming media for seekable Range playback", () => {
    expect(KEEL_PROTOCOL_SCHEME).toBe("serpent");
    expect(KEEL_PROTOCOL_PRIVILEGES.stream).toBe(true);
    expect(KEEL_PROTOCOL_PRIVILEGES.standard).toBe(true);
    expect(KEEL_PROTOCOL_PRIVILEGES.secure).toBe(true);
    expect(KEEL_PROTOCOL_PRIVILEGES.supportFetchAPI).toBe(true);

    const schemes = serpentProtocolSchemes();
    expect(schemes).toHaveLength(2);
    expect(schemes[0]?.scheme).toBe("serpent");
    expect(schemes[0]?.privileges.stream).toBe(true);
    expect(schemes[1]?.scheme).toBe(KEEL_PLUGIN_PROTOCOL_SCHEME);
    expect(schemes[1]?.privileges.stream).toBe(true);
  });
});
