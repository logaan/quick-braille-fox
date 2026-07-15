// Persistence: a versioned localStorage envelope around the core's
// serialize()/deserialize(), plus the state-layer extras (best qbf result,
// which skills have already had their introduction shown).

import type { QbfResult, SerializedTutorState, TutorState } from '../core';
import { deserialize, serialize } from '../core';

export const STORAGE_KEY = 'qbf-progress-v1';

/** Minimal Storage interface (subset of DOM Storage) for testability. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** A best qbf outcome worth remembering (never 'failed'). */
export type BestQbf = Exclude<QbfResult, { readonly kind: 'failed' }>;

export interface PersistedData {
  readonly tutor: TutorState;
  readonly bestQbf: BestQbf | null;
  readonly introducedSkillIds: ReadonlySet<string>;
}

interface Envelope {
  version: 1;
  tutor: SerializedTutorState;
  bestQbf: BestQbf | null;
  introducedSkillIds: string[];
}

function coerceBestQbf(raw: unknown): BestQbf | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as { kind?: unknown; percentAbove?: unknown };
  if (o.kind === 'crown') return { kind: 'crown' };
  if (
    o.kind === 'badge' &&
    typeof o.percentAbove === 'number' &&
    Number.isFinite(o.percentAbove) &&
    o.percentAbove >= 0
  ) {
    return { kind: 'badge', percentAbove: o.percentAbove };
  }
  return null;
}

/** Load persisted progress; null on absent, corrupt, or incompatible data. */
export function loadProgress(storage: StorageLike): PersistedData | null {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const env = parsed as Partial<Envelope>;
    if (env.version !== 1) return null;
    const tutor = deserialize(env.tutor); // throws TypeError on garbage
    const introducedSkillIds = new Set<string>(
      Array.isArray(env.introducedSkillIds)
        ? env.introducedSkillIds.filter((id): id is string => typeof id === 'string')
        : [],
    );
    return { tutor, bestQbf: coerceBestQbf(env.bestQbf), introducedSkillIds };
  } catch {
    return null;
  }
}

export function saveProgress(storage: StorageLike, data: PersistedData): void {
  const envelope: Envelope = {
    version: 1,
    tutor: serialize(data.tutor),
    bestQbf: data.bestQbf,
    introducedSkillIds: [...data.introducedSkillIds],
  };
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(envelope));
  } catch {
    // Quota exceeded / private mode: losing a save is non-fatal.
  }
}

export function clearProgress(storage: StorageLike): void {
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // Non-fatal.
  }
}
