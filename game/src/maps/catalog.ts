/**
 * Map registration (BR-WM-01 to BR-WM-07). The composition root calls createMapCatalog once;
 * there is no module-level registry. Accepted maps are deep-frozen (SD-WM-9) and returned by
 * reference, never copied (BR-WM-05).
 */
import { err, ok, type MapId, type Result } from '@sz/kernel';
import type { MapCatalog, MapDefinition, MapSummary, MapValidationError } from './types';
import { validateMap } from './validate';

function deepFreeze(value: unknown): void {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
}

export function createMapCatalog(
  defs: ReadonlyArray<MapDefinition>,
): Result<MapCatalog, ReadonlyArray<MapValidationError>> {
  const errors: MapValidationError[] = [];
  const byId = new Map<string, MapDefinition>();
  defs.forEach((def, i) => {
    if (byId.has(def.id)) {
      errors.push({ mapId: def.id, code: 'duplicate-map', path: `defs[${String(i)}].id` });
      return;
    }
    byId.set(def.id, def);
    errors.push(...validateMap(def));
  });
  if (errors.length > 0) return err(errors);

  for (const def of byId.values()) deepFreeze(def);
  const summaries: ReadonlyArray<MapSummary> = Object.freeze(
    [...byId.values()].map((d) => Object.freeze({ id: d.id, name: d.name, blurb: d.blurb })),
  );

  return ok({
    listMaps: () => summaries,
    getMap: (id: MapId) => byId.get(id),
    has: (id: MapId) => byId.has(id),
  });
}
