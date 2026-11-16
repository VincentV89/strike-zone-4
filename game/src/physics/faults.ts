/**
 * Fault containment (SD-WM-3): a Rapier call that throws mid-round returns its safe fallback
 * and is reported once per kind. The report carries only the kind and the engine message.
 */
export type FaultKind =
  | 'raycast'
  | 'lineOfSight'
  | 'overlap'
  | 'move'
  | 'setStance'
  | 'syncHitboxes'
  | 'setHitboxesEnabled'
  | 'teleport'
  | 'step'
  | 'addCharacter'
  | 'removeCharacter'
  | 'dispose';

export type Guarded = <T>(kind: FaultKind, fallback: T, fn: () => T) => T;

const MAX_MESSAGE = 200;

export function defaultReport(line: string): void {
  console.error(line);
}

export function createFaultReporter(report: (line: string) => void = defaultReport): Guarded {
  const seen = new Set<FaultKind>();
  return <T>(kind: FaultKind, fallback: T, fn: () => T): T => {
    try {
      return fn();
    } catch (e) {
      if (!seen.has(kind)) {
        seen.add(kind);
        const msg = e instanceof Error ? e.message : 'non-Error thrown';
        report(`physics: ${kind} failed: ${msg.slice(0, MAX_MESSAGE)}`);
      }
      return fallback;
    }
  };
}
