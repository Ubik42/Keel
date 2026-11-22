/**
 * Browsing hides text formats by default (bdc4ce02). An isolated E2E process
 * can opt out with KEEL_E2E_SHOW_TEXT=1, for fixtures that import text files;
 * a normal app always uses the default.
 */
export function defaultFormatFilter(): { formatFilter: string; excludeFormatFilter: boolean } {
  const e2e = (globalThis as { keel?: { e2e?: { showTextByDefault?: boolean } } }).keel?.e2e;
  return e2e?.showTextByDefault ? { formatFilter: "", excludeFormatFilter: false } : { formatFilter: "text", excludeFormatFilter: true };
}
