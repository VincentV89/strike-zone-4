// Recording bus for assertions: a real kernel EventBus that also keeps every emitted event.
import { createEventBus, type DomainEvent, type EventBus, type EventBusOptions } from '@sz/kernel';

export interface RecordingBus<E extends { readonly type: string }> extends EventBus<E> {
  readonly emitted: ReadonlyArray<E>;
  readonly errors: ReadonlyArray<{ readonly err: unknown; readonly type: string }>;
}

export function createRecordingBus<E extends { readonly type: string } = DomainEvent>(
  opts: EventBusOptions = {},
): RecordingBus<E> {
  const emitted: E[] = [];
  const errors: { err: unknown; type: string }[] = [];
  const inner = createEventBus<E>({
    onSubscriberError: (err, type) => {
      errors.push({ err, type });
      opts.onSubscriberError?.(err, type);
    },
  });
  return {
    emitted,
    errors,
    emit(e) {
      emitted.push(e);
      inner.emit(e);
    },
    drain: () => inner.drain(),
    subscribe: (type, fn) => inner.subscribe(type, fn),
    subscribeAll: (fn) => inner.subscribeAll(fn),
    clear: () => {
      inner.clear();
    },
    get pending() {
      return inner.pending;
    },
  };
}
