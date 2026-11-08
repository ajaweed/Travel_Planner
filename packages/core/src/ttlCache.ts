// A small expiring cache that lives on globalThis, so separately bundled Next
// routes share one instance (and one set of cached Wikimedia answers).
// Evicts oldest-first when full.

export type TtlCache<V> = {
  get(key: string, now?: number): V | undefined;
  set(key: string, value: V, ttlMs: number, now?: number): void;
  clear(): void;
};

export function ttlCache<V>(name: string, maxEntries: number): TtlCache<V> {
  const g = globalThis as unknown as Record<string, Map<string, { expires: number; value: V }> | undefined>;
  const slot = `__tripPlannerCache_${name}`;
  const map = () => (g[slot] ??= new Map());
  return {
    get(key, now = Date.now()) {
      const hit = map().get(key);
      if (!hit) return undefined;
      if (now >= hit.expires) {
        map().delete(key);
        return undefined;
      }
      return hit.value;
    },
    set(key, value, ttlMs, now = Date.now()) {
      const m = map();
      m.delete(key);
      if (m.size >= maxEntries) m.delete(m.keys().next().value!);
      m.set(key, { expires: now + ttlMs, value });
    },
    clear() {
      g[slot] = undefined;
    },
  };
}
