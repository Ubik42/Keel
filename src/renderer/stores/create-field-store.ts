import type { Dispatch, SetStateAction } from 'react';
import { create, type StoreApi, type UseBoundStore } from 'zustand';

/**
 * A zustand store of independent fields. `useField(key)` returns the same
 * `[value, setValue]` pair as `useState`, so state can leave App one field at
 * a time; other components subscribe to the same field directly.
 */
export interface FieldStore<S extends object> {
  store: UseBoundStore<StoreApi<S>>;
  useField: <K extends keyof S>(key: K) => [S[K], Dispatch<SetStateAction<S[K]>>];
  setterFor: <K extends keyof S>(key: K) => Dispatch<SetStateAction<S[K]>>;
  get: <K extends keyof S>(key: K) => S[K];
  /** Restore the initial values of the given fields (all when omitted). */
  reset: (keys?: readonly (keyof S)[]) => void;
}

export function createFieldStore<S extends object>(initial: () => S): FieldStore<S> {
  // Created on first use: initial values may read local storage, which a
  // module imported outside the renderer (tests in Node) does not have.
  let bound: UseBoundStore<StoreApi<S>> | undefined;
  const getStore = () => (bound ??= create<S>()(() => initial()));
  const setters = new Map<keyof S, Dispatch<SetStateAction<unknown>>>();
  function setterFor<K extends keyof S>(key: K): Dispatch<SetStateAction<S[K]>> {
    let setter = setters.get(key);
    if (!setter) {
      setter = (action: SetStateAction<unknown>) => {
        const previous = getStore().getState()[key];
        const next = typeof action === 'function'
          ? (action as (value: S[K]) => S[K])(previous)
          : action as S[K];
        if (Object.is(next, previous)) return;
        getStore().setState({ [key]: next } as unknown as Partial<S>);
      };
      setters.set(key, setter);
    }
    return setter as Dispatch<SetStateAction<S[K]>>;
  }
  return {
    get store() {
      return getStore();
    },
    setterFor,
    useField: (key) => [getStore()((state) => state[key]), setterFor(key)],
    get: (key) => getStore().getState()[key],
    reset: (keys) => {
      const fresh = initial();
      const patch: Partial<S> = {};
      for (const key of keys ?? (Object.keys(fresh) as (keyof S)[])) patch[key] = fresh[key];
      getStore().setState(patch);
    },
  };
}
