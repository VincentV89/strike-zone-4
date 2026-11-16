/**
 * Versioned envelope reader and writer (business-logic-model-ui-hud §5.2, SD-UI-7).
 * Total functions: any input gives a value or undefined, never a throw.
 */
import { MAX_RAW_LENGTH, SCHEMA_VERSION } from './keys';

/** A plain JSON object: not null, not an array, prototype Object.prototype. */
export function isPlainRecord(x: unknown): x is object {
  return (
    typeof x === 'object' &&
    x !== null &&
    !Array.isArray(x) &&
    Object.getPrototypeOf(x) === Object.prototype
  );
}

/**
 * Reads one own field. JSON.parse turns a "__proto__" key into an own data property, so a
 * hostile key is just a field nobody asks for.
 */
export function own(obj: object, key: string): unknown {
  return Object.hasOwn(obj, key) ? (obj as Record<string, unknown>)[key] : undefined;
}

/** Returns the envelope's `data`, or undefined for anything malformed, oversize or wrong-version. */
export function decodeEnvelope(raw: unknown): unknown {
  if (typeof raw !== 'string' || raw.length > MAX_RAW_LENGTH) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined; // SyntaxError, or RangeError on absurd nesting
  }
  if (!isPlainRecord(parsed)) return undefined;
  if (own(parsed, 'schemaVersion') !== SCHEMA_VERSION) return undefined;
  return own(parsed, 'data');
}

/** Compact JSON (PD-UI-23). `data` is always a literal built from validated fields (SD-UI-11). */
export function encodeEnvelope(data: unknown): string {
  return JSON.stringify({ schemaVersion: SCHEMA_VERSION, data });
}
