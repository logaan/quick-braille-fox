// Persistence: a versioned localStorage envelope around the core's
// serialize()/deserialize(), plus the state-layer extras (best fox result,
// input mode).

import type { FoxResult, SerializedTutorState, TutorState } from '../core';
import { deserialize, serialize } from '../core';
import type { InputMode } from './modes';
import { DEFAULT_INPUT_MODE, isInputMode } from './modes';

// Predates the "fox challenge" naming ("qbf" era); kept so progress survives.
export const STORAGE_KEY = 'qbf-progress-v1';

/** Minimal Storage interface (subset of DOM Storage) for testability. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** A best fox outcome worth remembering (never 'failed'). */
export type BestFox = Exclude<FoxResult, { readonly kind: 'failed' }>;

export interface PersistedData {
  readonly tutor: TutorState;
  readonly bestFox: BestFox | null;
  /** Which input mode the drill is in; see InputMode. */
  readonly inputMode: InputMode;
}

interface Envelope {
  version: 1;
  tutor: SerializedTutorState;
  /** Wire name predates the "fox challenge" naming; kept for stored data. */
  bestQbf: BestFox | null;
  /** Optional (added later); absent/garbage loads as DEFAULT_INPUT_MODE,
   * keeping the original VoiceOver behaviour for existing envelopes. */
  inputMode?: InputMode;
  /**
   * The pre-rename spelling of the same setting: true = 'voiceover',
   * false = 'emulated'. Only ever read, never written — envelopes are
   * rewritten with `inputMode` on the next save.
   */
  voiceOverInput?: boolean;
}

/**
 * Resolve the input mode from an envelope that may use either the current
 * `inputMode` field or the legacy `voiceOverInput` boolean. The version is
 * not bumped for the rename: the loader reads both shapes, so an old
 * envelope stays readable and gains nothing from a migration step.
 */
function coerceInputMode(env: Partial<Envelope>): InputMode {
  if (isInputMode(env.inputMode)) return env.inputMode;
  if (typeof env.voiceOverInput === 'boolean') {
    return env.voiceOverInput ? 'voiceover' : 'emulated';
  }
  return DEFAULT_INPUT_MODE;
}

function coerceBestFox(raw: unknown): BestFox | null {
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
    return {
      tutor,
      bestFox: coerceBestFox(env.bestQbf),
      inputMode: coerceInputMode(env),
    };
  } catch {
    return null;
  }
}

export function saveProgress(storage: StorageLike, data: PersistedData): void {
  const envelope: Envelope = {
    version: 1,
    tutor: serialize(data.tutor),
    bestQbf: data.bestFox,
    inputMode: data.inputMode,
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
