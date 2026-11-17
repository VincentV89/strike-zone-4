/**
 * Shared widgets for screens and dialogs (frontend-components "Props and state"): segmented
 * radio groups, sliders and inline confirmations. Native controls only; values are sent raw and
 * validated by app-shell through the core reducers.
 */
import type { ChoiceOption } from '@sz/ui/core/setup-model';
import type { SliderModel } from '@sz/ui/core/settings-model';
import { append, button, h, on, type Cleanup } from './el';

export interface Scope {
  readonly cleanups: Cleanup[];
  add(c: Cleanup): void;
  dispose(): void;
}

export function createScope(): Scope {
  const cleanups: Cleanup[] = [];
  return {
    cleanups,
    add: (c) => cleanups.push(c),
    dispose() {
      for (const c of cleanups.splice(0)) c();
    },
  };
}

let uid = 0;
/** Unique id for aria wiring. */
export function nextId(prefix: string): string {
  uid += 1;
  return `${prefix}-${String(uid)}`;
}

export interface RadioGroup {
  readonly root: HTMLFieldSetElement;
  sync(options: ReadonlyArray<ChoiceOption<string | number>>, description?: string): void;
}

/** <fieldset> + <legend> with one native radio per option (frontend-components a11y notes). */
export function radioGroup(
  scope: Scope,
  legend: string,
  testPrefix: string,
  options: ReadonlyArray<ChoiceOption<string | number>>,
  onChange: (raw: string) => void,
  description?: string,
): RadioGroup {
  const name = nextId(testPrefix);
  const descId = nextId(`${testPrefix}-desc`);
  const root = h('fieldset', { class: 'sz-segmented', 'data-testid': testPrefix });
  root.appendChild(h('legend', {}, legend));
  const inputs: HTMLInputElement[] = [];
  const row = h('div', { class: 'sz-segments' });
  for (const o of options) {
    const id = nextId(name);
    const input = h('input', {
      type: 'radio',
      id,
      name,
      value: String(o.value),
      'data-testid': `${testPrefix}-option-${String(o.value)}`,
    });
    input.checked = o.checked;
    if (description !== undefined) input.setAttribute('aria-describedby', descId);
    scope.add(
      on(input, 'change', () => {
        if (input.checked) onChange(input.value);
      }),
    );
    inputs.push(input);
    row.appendChild(
      append(h('label', { for: id, class: 'sz-segment' }), input, h('span', {}, o.label)),
    );
  }
  root.appendChild(row);
  const desc = h('p', { id: descId, class: 'sz-help', 'data-testid': `${testPrefix}-description` });
  if (description !== undefined) {
    desc.textContent = description;
    root.appendChild(desc);
  }
  return {
    root,
    sync(next, d) {
      for (const o of next) {
        const input = inputs.find((i) => i.value === String(o.value));
        if (input && input.checked !== o.checked) input.checked = o.checked;
      }
      if (d !== undefined && desc.textContent !== d) desc.textContent = d;
    },
  };
}

export interface Slider {
  readonly root: HTMLElement;
  readonly input: HTMLInputElement;
  sync(m: SliderModel): void;
}

export function slider(scope: Scope, m: SliderModel, onInput: (raw: string) => void): Slider {
  const id = nextId(`slider-${m.key}`);
  const input = h('input', {
    type: 'range',
    id,
    min: String(m.min),
    max: String(m.max),
    step: String(m.step),
    value: String(m.value),
    'aria-valuetext': m.valueText,
    'data-testid': `settings-${m.key}-slider`,
  });
  const out = h('output', { for: id, 'data-testid': `settings-${m.key}-value` }, m.valueText);
  scope.add(
    on(input, 'input', () => {
      onInput(input.value);
    }),
  );
  const root = append(
    h('div', { class: 'sz-slider' }),
    h('label', { for: id }, m.label),
    input,
    out,
  );
  return {
    root,
    input,
    sync(next) {
      if (input.value !== String(next.value)) input.value = String(next.value);
      input.setAttribute('aria-valuetext', next.valueText);
      if (out.textContent !== next.valueText) out.textContent = next.valueText;
    },
  };
}

/** Swap-in confirmation with Cancel focused first (frontend-components InlineConfirm). */
export function inlineConfirm(
  scope: Scope,
  testPrefix: string,
  question: string,
  consequence: string,
  confirmLabel: string,
  onConfirm: () => void,
  onCancel: () => void,
): HTMLElement {
  const cancel = button(`${testPrefix}-cancel-button`, 'Cancel');
  const confirm = button(`${testPrefix}-confirm-button`, confirmLabel, 'sz-btn sz-btn-danger');
  scope.add(on(cancel, 'click', onCancel));
  scope.add(on(confirm, 'click', onConfirm));
  return append(
    h('div', { class: 'sz-confirm', role: 'group', 'data-testid': testPrefix }),
    h('p', { class: 'sz-confirm-question' }, question),
    h('p', { class: 'sz-help' }, consequence),
    append(h('div', { class: 'sz-actions' }), cancel, confirm),
  );
}
