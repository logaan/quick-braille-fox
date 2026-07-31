// UEB lower-sign placement rules, shared by the forward translator
// (braille.ts) and the back-translator (backtranslate.ts) so the two can
// never drift apart; prompts.ts also consults the standalone list. The
// classification *data* lives here; each side applies it to its own medium
// (print spans forward, cell buffers backward), which is why the positional
// predicates themselves stay medium-specific.

/** Lower signs that may stand alone as whole words. */
export const STANDALONE_LOWER: ReadonlySet<string> = new Set([
  'be',
  'enough',
  'his',
  'in',
  'was',
  'were',
]);

/** Lower signs allowed strictly inside a word (never first or last). */
export const INTERIOR_LOWER: ReadonlySet<string> = new Set(['ea', 'bb', 'cc', 'ff', 'gg']);

/** Lower signs allowed only at the start of a word (syllable heuristic). */
export const BEGWORD_LOWER: ReadonlySet<string> = new Set(['be', 'con', 'dis']);

/** Lower signs usable anywhere in a word. */
export const ANYWHERE_LOWER: ReadonlySet<string> = new Set(['en', 'in']);

/** Letters that must follow a begword lower sign (the be/con/dis heuristic). */
export const MIN_BEGWORD_TAIL = 3;
