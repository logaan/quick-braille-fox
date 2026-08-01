// How the learner enters braille, and how much the announcements say. Their
// own module because both the view models and persistence name them, and
// persistence must not depend on the view layer.

/**
 * 'emulated': braille chords typed on the QWERTY home row (f d s a j k l ;).
 * 'voiceover': VoiceOver braille screen input, where the OS commits whole
 * words (and contractions) as single insertions.
 */
export type InputMode = 'emulated' | 'voiceover';

/** The mode a learner with no saved preference starts in. */
export const DEFAULT_INPUT_MODE: InputMode = 'voiceover';

/** Human-readable option labels, in the order the picker shows them. */
export const INPUT_MODE_LABELS: readonly {
  readonly mode: InputMode;
  readonly label: string;
}[] = [
  { mode: 'emulated', label: 'Emulated' },
  { mode: 'voiceover', label: 'VoiceOver' },
];

export function isInputMode(value: unknown): value is InputMode {
  return value === 'emulated' || value === 'voiceover';
}

/**
 * How much the announcements and status strings say. 'terse' is for
 * practiced users — especially on a braille display, where every boilerplate
 * word costs a pan of a 14–40 cell line: fixed prefixes go, fox rules
 * collapse behind a disclosure, and the fox result shrinks to its first
 * line. The default stays 'verbose' so first-time users get full sentences.
 */
export type Verbosity = 'verbose' | 'terse';

export const DEFAULT_VERBOSITY: Verbosity = 'verbose';

export function isVerbosity(value: unknown): value is Verbosity {
  return value === 'verbose' || value === 'terse';
}
