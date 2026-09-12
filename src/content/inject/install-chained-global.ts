/**
 * Install a window (or object) property that survives later reassignment.
 *
 * Page scripts and other tools may wrap or replace globals, e.g.:
 *   const prev = window.fetch;
 *   window.fetch = (...args) => prev(...args);
 * A plain `window.fetch = ourHook` is then lost. With get/set, the getter always
 * returns our entry while the setter updates the downstream callee.
 *
 * Re-entrancy: if a later wrapper closes over our entry (prev === ourHook),
 * calling through downstream would recurse into our hook. A Proxy apply/construct
 * guard routes re-entry to `native` (value at install time) so instrumentation
 * runs once and the cycle breaks.
 */

export type ChainedGlobalHandle<T> = {
  /** Always the installed entry (what getters return). */
  entry: T;
  /** Current downstream callee; updated when the property is reassigned. */
  getDownstream: () => T;
};

export type ChainedGlobalApi<T> = {
  getDownstream: () => T;
  applyDownstream: (self: unknown, args: unknown[]) => unknown;
  constructDownstream: (args: unknown[]) => object;
};

export function installChainedGlobal<T extends object>(
  target: object,
  key: string,
  native: T,
  createEntry: (api: ChainedGlobalApi<T>) => T,
): ChainedGlobalHandle<T> {
  let downstream: T = native;
  let depth = 0;

  const getDownstream = (): T => downstream;

  const applyDownstream = (self: unknown, args: unknown[]): unknown =>
    Reflect.apply(getDownstream() as (...a: unknown[]) => unknown, self, args);

  const constructDownstream = (args: unknown[]): object =>
    Reflect.construct(getDownstream() as new (...a: unknown[]) => object, args);

  const rawEntry = createEntry({ getDownstream, applyDownstream, constructDownstream });

  const entry = new Proxy(rawEntry, {
    apply(t, thisArg, args) {
      if (depth > 0) {
        return Reflect.apply(native as (...a: unknown[]) => unknown, thisArg, args);
      }
      depth += 1;
      try {
        return Reflect.apply(t as (...a: unknown[]) => unknown, thisArg, args);
      } finally {
        depth -= 1;
      }
    },
    construct(t, args, newTarget) {
      if (depth > 0) {
        return Reflect.construct(native as new (...a: unknown[]) => object, args, newTarget);
      }
      depth += 1;
      try {
        return Reflect.construct(t as new (...a: unknown[]) => object, args, newTarget);
      } finally {
        depth -= 1;
      }
    },
  }) as T;

  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    get(): T {
      return entry;
    },
    set(next: T): void {
      if (next === entry || next === rawEntry) return;
      if (next == null) return;
      downstream = next;
    },
  });

  return { entry, getDownstream };
}
