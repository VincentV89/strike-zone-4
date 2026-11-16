// Public surface of the input adapter (re-exports only).
export { createInput } from './dom/bind';
export type { InputAdapter, InputEventMap, InputEventType } from './dom/bind';
export type { LockErrorEvent, LockLostEvent } from './dom/lock';
export type { InputDeps, LockDocument, LockTarget, Listenable } from './dom/ports';
export { DEFAULT_BINDINGS, FORBIDDEN_CODES, validateBindings } from './core/bindings';
export type { BindingError, InputAction, KeyBindings } from './core/bindings';
