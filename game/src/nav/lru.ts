/**
 * Small LRU cache over Map insertion order (LC-WM-09). Values are stored as given; the
 * navigation graph stores frozen node arrays only.
 */
export interface Lru<K, V> {
  get(key: K): V | undefined;
  set(key: K, value: V): void;
  readonly size: number;
}

export function createLru<K, V>(capacity: number): Lru<K, V> {
  const cap = Math.max(1, Math.floor(capacity));
  const map = new Map<K, V>();
  return {
    get(key) {
      const v = map.get(key);
      if (v === undefined) return undefined;
      map.delete(key);
      map.set(key, v);
      return v;
    },
    set(key, value) {
      map.delete(key);
      map.set(key, value);
      if (map.size > cap) {
        const oldest = map.keys().next();
        if (oldest.done !== true) map.delete(oldest.value);
      }
    },
    get size() {
      return map.size;
    },
  };
}
