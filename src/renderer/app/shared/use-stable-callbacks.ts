import { useInsertionEffect, useRef } from "react";

/**
 * A context value or props object whose functions keep their identity across
 * renders and always call the latest implementation, while a change in any
 * non-function member still produces a new object. Lets memoized consumers
 * skip renders caused only by new closures in the parent.
 *
 * The latest value is installed in an insertion effect, which runs before
 * any layout or passive effect, so effects of children call the current code.
 */
export function useStableCallbacks<T extends object>(value: T): T {
  const latest = useRef(value);
  useInsertionEffect(() => {
    latest.current = value;
  });
  const cache = useRef<{ functionKeys: string; data: unknown[]; dataKeys: string[]; result: T } | null>(null);
  const keys = Object.keys(value) as Array<keyof T & string>;
  const functionKeys = keys.filter((key) => typeof value[key] === "function");
  const dataKeys = keys.filter((key) => typeof value[key] !== "function");
  const data = dataKeys.map((key) => value[key]);
  const signature = functionKeys.join("|");
  const previous = cache.current;
  const unchanged = previous !== null
    && previous.functionKeys === signature
    && previous.dataKeys.length === dataKeys.length
    && previous.dataKeys.every((key, index) => key === dataKeys[index] && Object.is(previous.data[index], data[index]));
  if (unchanged) return previous.result;
  const result = {} as Record<string, unknown>;
  for (const key of functionKeys) {
    const reused = previous?.functionKeys === signature ? (previous.result as Record<string, unknown>)[key] : undefined;
    result[key] = reused ?? ((...args: unknown[]) => (latest.current[key] as (...a: unknown[]) => unknown)(...args));
  }
  dataKeys.forEach((key, index) => {
    result[key] = data[index];
  });
  cache.current = { functionKeys: signature, data, dataKeys, result: result as T };
  return result as T;
}
