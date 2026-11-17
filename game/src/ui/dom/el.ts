/**
 * DOM helpers (logical-components C10, security-design-ui-hud §3). Every ui element is built
 * here. Tag and attribute names are closed literal unions, text goes through textContent, and
 * listeners through addEventListener. The three lint disables below are the only ones in ui
 * (residual risk R-UI-1): their keys are TypeScript literal unions, never outside input.
 */

export const SVG_NS = 'http://www.w3.org/2000/svg';

export type HtmlTag =
  | 'div'
  | 'span'
  | 'p'
  | 'h1'
  | 'h2'
  | 'button'
  | 'section'
  | 'header'
  | 'nav'
  | 'main'
  | 'footer'
  | 'ul'
  | 'ol'
  | 'li'
  | 'dl'
  | 'dt'
  | 'dd'
  | 'fieldset'
  | 'legend'
  | 'label'
  | 'input'
  | 'output'
  | 'table'
  | 'thead'
  | 'tbody'
  | 'tr'
  | 'th'
  | 'td'
  | 'dialog'
  | 'strong';

export type SvgTag = 'svg' | 'g' | 'path' | 'circle' | 'line' | 'polygon' | 'clipPath' | 'defs';

export type AttrName =
  | 'class'
  | 'id'
  | 'role'
  | 'tabindex'
  | 'type'
  | 'name'
  | 'value'
  | 'min'
  | 'max'
  | 'step'
  | 'for'
  | 'scope'
  | 'aria-label'
  | 'aria-labelledby'
  | 'aria-describedby'
  | 'aria-live'
  | 'aria-atomic'
  | 'aria-hidden'
  | 'aria-disabled'
  | 'aria-valuetext'
  | 'data-testid'
  | 'data-bot'
  | 'data-kind'
  | 'data-state'
  | 'd'
  | 'cx'
  | 'cy'
  | 'r'
  | 'x1'
  | 'y1'
  | 'x2'
  | 'y2'
  | 'points'
  | 'transform'
  | 'clip-path'
  | 'viewBox'
  | 'focusable'
  | 'opacity'
  | 'stroke-dasharray'
  | 'stroke-dashoffset';

export type Attrs = Partial<Record<AttrName, string>>;

function applyAttrs(el: Element, attrs: Attrs): void {
  for (const [name, value] of Object.entries(attrs) as [AttrName, string | undefined][]) {
    if (value === undefined) continue;
    // eslint-disable-next-line no-restricted-syntax -- R-UI-1: `name` is the AttrName literal union, which excludes on*, style, href and src.
    el.setAttribute(name, value);
  }
}

/** An HTML element with literal-typed attributes and optional text content. */
export function h<K extends HtmlTag>(
  tag: K,
  attrs: Attrs = {},
  text?: string,
): HTMLElementTagNameMap[K] {
  // eslint-disable-next-line no-restricted-syntax -- R-UI-1: `tag` is the HtmlTag literal union, which excludes script, iframe, a, form, style and link.
  const el = document.createElement(tag);
  applyAttrs(el, attrs);
  if (text !== undefined) el.textContent = text;
  return el;
}

/** An SVG element (namespace literal above). */
export function svg<K extends SvgTag>(tag: K, attrs: Attrs = {}): SVGElementTagNameMap[K] {
  // eslint-disable-next-line no-restricted-syntax -- R-UI-1: `tag` is the SvgTag literal union, which excludes foreignObject and script.
  const el = document.createElementNS(SVG_NS, tag);
  applyAttrs(el, attrs);
  return el;
}

/** Writes text only when it changed. */
export function text(el: Element, value: string): void {
  if (el.textContent !== value) el.textContent = value;
}

/** Appends children and returns the parent. */
export function append<T extends Element>(parent: T, ...children: Element[]): T {
  for (const c of children) parent.appendChild(c);
  return parent;
}

export type Cleanup = () => void;

/** addEventListener with a matching cleanup. */
export function on<K extends keyof HTMLElementEventMap>(
  el: HTMLElement,
  type: K,
  fn: (e: HTMLElementEventMap[K]) => void,
): Cleanup {
  el.addEventListener(type, fn);
  return () => {
    el.removeEventListener(type, fn);
  };
}

export function button(testid: string, label: string, cls = 'sz-btn'): HTMLButtonElement {
  return h('button', { type: 'button', class: cls, 'data-testid': testid }, label);
}

/** Moves focus without scrolling (frontend-components focus rules). */
export function focusEl(el: Element | null | undefined): void {
  if (el instanceof HTMLElement || el instanceof SVGElement) el.focus({ preventScroll: true });
}

export function byTestId(root: ParentNode, testid: string): HTMLElement | null {
  const all = root.querySelectorAll('[data-testid]');
  for (let i = 0; i < all.length; i++) {
    const el = all.item(i);
    if (el instanceof HTMLElement && el.dataset['testid'] === testid) return el;
  }
  return null;
}
