// How the learner enters braille. Its own module because both the view
// models and persistence name the mode, and persistence must not depend on
// the view layer.

/**
 * 'emulated': braille chords typed on the QWERTY home row (f d s a j k l ;).
 * 'voiceover': VoiceOver braille screen input, where the OS commits whole
 * words (and contractions) as single insertions.
 */
export type InputMode = 'emulated' | 'voiceover';

/** The mode a learner with no saved preference starts in. */
export const DEFAULT_INPUT_MODE: InputMode = 'voiceover';

/** Human-readable option labels, in the order the picker shows them. */
export const INPUT_MODE_LABELS: ReadonlyArray<{
  readonly mode: InputMode;
  readonly label: string;
}> = [
  { mode: 'emulated', label: 'Emulated' },
  { mode: 'voiceover', label: 'VoiceOver' },
];

export function isInputMode(value: unknown): value is InputMode {
  return value === 'emulated' || value === 'voiceover';
}
