/**
 * Voice admission and stealing (business-logic-model-game-audio W8,
 * BR-A-31 to BR-A-34, BR-A-38). Never reads a clock: time is passed in.
 */
import type { AdmitDecision, CueCategory, SoundCue, VoiceRecord } from './types';

export interface VoicePolicyOptions {
  readonly maxVoices: number;
  readonly caps: ReadonlyMap<CueCategory, number>;
}

export interface AdmitRequest {
  readonly cue: SoundCue;
  readonly key: string;
  readonly category: CueCategory;
  readonly priority: number;
  readonly retriggerSec: number;
}

export interface VoicePolicy {
  /**
   * Decides whether a new voice may start. When it names a voice to steal, that
   * record is already removed; the caller only stops its nodes.
   */
  admit(req: AdmitRequest, now: number): AdmitDecision;
  started(rec: Omit<VoiceRecord, 'id'>): number;
  /** Idempotent. */
  ended(id: number): void;
  readonly count: number;
  countIn(category: CueCategory): number;
}

/** lastStart entries older than this are never needed (largest retriggerSec is 0.5 s). */
const KEY_MEMORY_SEC = 1;
const KEY_PRUNE_THRESHOLD = 64;

/** Oldest voice of the lowest priority, among those at or below `maxPriority`. */
function pickVictim(records: Iterable<VoiceRecord>, maxPriority: number): VoiceRecord | undefined {
  let victim: VoiceRecord | undefined;
  for (const r of records) {
    if (r.priority > maxPriority) continue;
    if (
      victim === undefined ||
      r.priority < victim.priority ||
      (r.priority === victim.priority && r.startedAt < victim.startedAt)
    ) {
      victim = r;
    }
  }
  return victim;
}

export function createVoicePolicy(opts: VoicePolicyOptions): VoicePolicy {
  const records = new Map<number, VoiceRecord>();
  const lastStart = new Map<string, number>();
  let nextId = 1;

  function prune(now: number): void {
    for (const [id, r] of records) if (r.endsAt <= now) records.delete(id);
    if (lastStart.size <= KEY_PRUNE_THRESHOLD) return;
    for (const [k, t] of lastStart) if (now - t >= KEY_MEMORY_SEC) lastStart.delete(k);
  }

  function steal(pool: Iterable<VoiceRecord>, priority: number): VoiceRecord | undefined {
    const victim = pickVictim(pool, priority);
    if (victim !== undefined) records.delete(victim.id);
    return victim;
  }

  function admit(req: AdmitRequest, now: number): AdmitDecision {
    prune(now);
    const last = lastStart.get(req.key);
    if (req.retriggerSec > 0 && last !== undefined && now - last < req.retriggerSec) {
      return { admit: false, reason: 'retrigger' };
    }
    const inCategory = [...records.values()].filter((r) => r.category === req.category);
    if (inCategory.length >= (opts.caps.get(req.category) ?? 0)) {
      const victim = steal(inCategory, req.priority);
      return victim
        ? { admit: true, stealVoiceId: victim.id }
        : { admit: false, reason: 'category-full' };
    }
    if (records.size >= opts.maxVoices) {
      const victim = steal(records.values(), req.priority);
      return victim
        ? { admit: true, stealVoiceId: victim.id }
        : { admit: false, reason: 'pool-full' };
    }
    return { admit: true };
  }

  return {
    admit,
    started(rec) {
      const id = nextId++;
      records.set(id, { ...rec, id });
      lastStart.set(rec.key, rec.startedAt);
      return id;
    },
    ended(id) {
      records.delete(id);
    },
    get count() {
      return records.size;
    },
    countIn(category) {
      let n = 0;
      for (const r of records.values()) if (r.category === category) n++;
      return n;
    },
  };
}
