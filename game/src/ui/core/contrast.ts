/**
 * Contrast gate (business-logic-model-ui-hud §9.4, team HUD contrast rule). The plate
 * rgba(8,11,15,.75) is alpha-blended over pure white first, then the WCAG relative-luminance
 * formula is applied. styles.css must use exactly these tokens (pinned by a test).
 */

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export const TOKENS = Object.freeze({
  text: '#E8EDF2',
  secondary: '#A9B4C0',
  amber: '#F2A93B',
  red: '#FF5C5C',
  plate: 'rgba(8, 11, 15, 0.75)',
});

/** Tokens allowed as a CSS `color` (text). Red is shapes only (BR-UI-21). */
export const TEXT_COLOR_TOKENS: ReadonlyArray<string> = Object.freeze([
  TOKENS.text,
  TOKENS.secondary,
  TOKENS.amber,
]);

export const PLATE_RGB: Rgb = Object.freeze({ r: 8, g: 11, b: 15 });
export const PLATE_ALPHA = 0.75;
export const WHITE: Rgb = Object.freeze({ r: 255, g: 255, b: 255 });

export function hexToRgb(hex: string): Rgb {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return { r: 0, g: 0, b: 0 };
  return {
    r: parseInt(m[1] ?? '0', 16),
    g: parseInt(m[2] ?? '0', 16),
    b: parseInt(m[3] ?? '0', 16),
  };
}

/** fg drawn at `alpha` over bg. */
export function blend(fg: Rgb, bg: Rgb, alpha: number): Rgb {
  const mix = (f: number, b: number) => Math.round(f * alpha + b * (1 - alpha));
  return { r: mix(fg.r, bg.r), g: mix(fg.g, bg.g), b: mix(fg.b, bg.b) };
}

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function luminance(c: Rgb): number {
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

export function contrast(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** The plate as seen over a pure-white scene (#46484B). */
export function plateOverWhite(): Rgb {
  return blend(PLATE_RGB, WHITE, PLATE_ALPHA);
}
