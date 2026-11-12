export const INTERFACE_SCALE_KEY = 'serpent.interface-scale.v1';
export function normalizeInterfaceScale(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(75, Math.min(200, Math.round(value / 5) * 5)) : 100;
}
export function loadInterfaceScale(): number {
  try { const stored = localStorage.getItem(INTERFACE_SCALE_KEY); return stored === null ? 100 : normalizeInterfaceScale(JSON.parse(stored)); } catch { return 100; }
}
export function applyInterfaceScale(value: number): void {
  const percent = normalizeInterfaceScale(value);
  const bridge = (globalThis as typeof globalThis & { serpent?: { shell?: { setInterfaceScale?: (percent: number) => void } } }).serpent;
  bridge?.shell?.setInterfaceScale?.(percent);
  document.documentElement.dataset.interfaceScale = String(percent);
}
export function saveInterfaceScale(value: number): number {
  const percent = normalizeInterfaceScale(value);
  try { localStorage.setItem(INTERFACE_SCALE_KEY, JSON.stringify(percent)); } catch { /* Keep the current session usable. */ }
  applyInterfaceScale(percent); return percent;
}
