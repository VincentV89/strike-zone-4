// RenderCanvas fake (RD-R-1): getContext returns null or a placeholder; listeners are recorded.
import type { ContextEventType, RenderCanvas } from '@sz/render/gl/ports';

export interface FakeRenderCanvas extends RenderCanvas {
  readonly listeners: Map<string, Set<(e: Event) => void>>;
  readonly contextRequests: number;
  fire(type: ContextEventType): Event;
}

export function createFakeRenderCanvas(
  context: WebGL2RenderingContext | null = null,
): FakeRenderCanvas {
  const listeners = new Map<string, Set<(e: Event) => void>>();
  let requests = 0;
  return {
    clientWidth: 1920,
    clientHeight: 1080,
    listeners,
    get contextRequests() {
      return requests;
    },
    getContext() {
      requests += 1;
      return context;
    },
    addEventListener(type, fn) {
      const set = listeners.get(type) ?? new Set();
      set.add(fn);
      listeners.set(type, set);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
    fire(type) {
      const e = new Event(type, { cancelable: true });
      for (const fn of listeners.get(type) ?? []) fn(e);
      return e;
    },
  };
}
