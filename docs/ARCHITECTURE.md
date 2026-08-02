# Architecture

A web app that teaches Unified English Braille (UEB): grade 1 (uncontracted)
first, then grade 2 (contractions and shortforms). Ground truth for all
braille definitions is the set of liblouis tables that macOS VoiceOver ships;
where macOS differs from other sources, macOS wins.

## Stack

- **Vite + TypeScript + React + Immutable.js.**
- **No JSX.** Every source file is plain `.ts`. UI code uses
  `import { createElement as e } from 'react'`.
- `tsconfig.json` is strict (`strict`, `noUncheckedIndexedAccess`, etc.) and
  has `resolveJsonModule` on so the generated JSON imports with types.
- Tests: vitest (`npm test` runs `vitest run --passWithNoTests`).

## Layout

```
index.html                  Vite entry, loads src/main.ts
src/
  main.ts                   creates the store, renders the UI on each change
  core/                     pure domain logic (no DOM, no React, no I/O)
  state/                    interaction store, timers, persistence
  ui/                       presentation; createElement only, no JSX
    styles.css              the app stylesheet (imported from main.ts)
  data/
    skills.json             GENERATED curriculum data (committed)
    skills.ts               types + typed export of skills.json
scripts/
  copy-braille-tables.sh    copies liblouis tables from macOS into data/
  generate-skills.mjs       parses data/ tables -> src/data/skills.json
  generate-skills.sh        copy-braille-tables.sh (if needed) + generator
  dev.sh / preview.sh       vite dev server / serve the production build
  test.sh / typecheck.sh    vitest run / tsc --noEmit
  build.sh                  typecheck + production build
data/                       gitignored; the copied liblouis tables
docs/ARCHITECTURE.md        this file
```

Dependency direction: `ui -> state -> core`, and anything may read
`src/data`. `core` must stay pure.

## Data pipeline

```
macOS liblouis tables --copy-braille-tables.sh--> data/
data/ --npm run generate (scripts/generate-skills.mjs)--> src/data/skills.json
```

`data/` is gitignored (Apple-shipped files); `src/data/skills.json` **is**
committed so the app builds on machines without the macOS tables. After
changing the generator or refreshing `data/`, rerun `npm run generate`.

The generator is plain Node with no dependencies. It parses:

- `data/en-ueb-chardefs.uti`, following its `include` directives (letters
  actually live in the included `latinLetterDef6Dots.uti`):
  - letters: `lowercase <char> <dots>`
  - digits: `litdigit <digit> <dots>` — the UEB "upper" numbers (1 = the "a"
    cell, preceded in text by the number sign). The `digit` opcode rules in
    the same file are lower-cell patterns for other modes; do not use them.
  - punctuation: `punctuation <char> <dots>`
  - extended symbols: looked up across the `punctuation`, `sign`, and `math`
    opcodes (e.g. `/` and `+` are `math`, `$` a `sign`); a `noback` prefix is
    tolerated (en dash and the smart single quotes are only defined that way)
- `data/en-ueb-g1.ctb`: `numsign 3456` (the numeric indicator),
  `capsletter 6` and `begcapsword 6-6` (the capitalisation indicators —
  their own curriculum skills).
- `data/en-ueb-g2.ctb`: grade 2. This table is a full translation ruleset —
  thousands of exception rules (proper nouns, compound words, `noback pass2`
  fixups) — so the generator does **not** emit every rule. It carries a
  curated list of learnable print strings (the standard UEB inventory:
  wordsigns, strong contractions/groupsigns, lower signs, initial-letter
  contractions, final-letter groupsigns, shortforms) and looks up each
  string's canonical dot pattern in the table, accepting these rule shapes:
  - `[nofor] <opcode> <print> <dots>` for opcodes like `word`, `always`,
    `lowword`, `begword`, `midword`, `midendword`, …
  - `[empmatchafter] match <pre> <print> <post> <dots>` (shortforms, "be",
    "there", "those" are only defined via `match` rules)

  Among all matching rules, the **shortest dot pattern wins** — the table
  also spells the same strings out letter-by-letter in exception rules
  (e.g. `always enough 26-1256-126` vs the wordsign `nofor lowword
  enough 26`), and the contraction is always the shorter form. Dots operands
  that are not plain 6-dot patterns (`=`, virtual-dot markers like `46-15b`,
  dots 7/8) are rejected.

  The script hard-fails (exit 1) if any curated string cannot be resolved or
  if built-in sanity checks fail ("a"=1, capsletter=6, begcapsword=6-6,
  "and"=12346, "ing"=346, "the"=2346, numsign=3456, "be"=23,
  "there"=5-2346, "ance"=46-15, "about"=1-12, ellipsis=256-256-256,
  em dash=6-36, "$"=4-234, "/"=456-34).

## Skill record format

`src/data/skills.json` is a flat array, already in curriculum order:

```ts
interface Skill {
  id: string;        // stable unique id, e.g. "letter-a", "groupsign-ing",
                     // "initial-day", "shortform-about", "punct-comma"
  kind: SkillKind;   // "letter" | "capital" | "number" | "number-sign"
                     // | "punctuation" | "wordsign" | "contraction"
                     // | "groupsign" | "lowersign" | "initial-letter"
                     // | "final-letter" | "shortform"
  print: string;     // print form: "a", "7", ",", "and", "ing", "about"
  dots: number[][];  // braille cells; each cell = ascending dot numbers 1-6
                     // "ing" -> [[3,4,6]]; "about" -> [[1],[1,2]]
  unicode: string;   // same cells in the U+2800 block; dot n = bit 1<<(n-1)
  group: SkillGroup; // curriculum group, see below
  order: number;     // global curriculum index; 0-based, dense, equals the
                     // record's array position
}
```

Import via `src/data/skills.ts` (`import { skills } from '../data/skills'`),
which types the JSON and documents the invariants.

### Curriculum groups, in order (258 skills total)

| group | count | contents |
|---|---|---|
| `letters` | 26 | a–z, alphabetical |
| `capitals` | 2 | capital letter indicator ⠠ (id `capital-letter-indicator`, print "A") and capital word indicator ⠠⠠ (id `capital-word-indicator`, print "AA") |
| `numbers` | 11 | number sign (⠼, its own skill, print "#"), then digits 0–9 |
| `punctuation` | 11 | . , ; : ? ! ' " - ( ) |
| `alphabetic-wordsigns` | 23 | but can do … you, plus "as" |
| `strong-contractions` | 5 | and for of the with |
| `strong-wordsigns` | 6 | child shall this which out still |
| `strong-groupsigns` | 12 | ch gh sh th wh ed er ou ow st ar ing |
| `lower-signs` | 14 | ea bb cc ff gg be con dis en in enough his was were |
| `initial-letter-contractions` | 33 | dot-5 (day … there), dots-45 (these those upon whose word), dots-456 (cannot had many spirit their world) |
| `final-letter-groupsigns` | 12 | ound ance sion less ount ence ong ful tion ness ment ity |
| `shortforms` | 75 | about above … yourselves |
| `symbols` | 28 | the rest of what English typing on macOS needs: [ ] { } / \ – — ‘ ’ “ ” … @ & * # $ % _ \| + = < > ~ ^ ` (kind `punctuation`, taught last) |

## Core API (`src/core`)

Pure domain logic: no DOM, no timers, no storage, no React. All state is
Immutable.js (`Record`, `Map`); every transition returns a new state. Import
everything from `src/core` (`import { startSession, keystroke } from
'../core'`) — the submodules are implementation detail.

### Game rules implemented

- Every skill has a score (default 0). Score **reaches 10 ⇒ learnt**
  (`LEARNT_THRESHOLD = 10`, `isLearntScore`).
- Exactly the 5 unlearnt skills earliest in curriculum order are **active**
  (`ACTIVE_SKILL_COUNT = 5`). When one crosses the threshold the next
  unlearnt skill takes its place; a learnt skill knocked back below the
  threshold rejoins the pool automatically.
- **Every skill occurrence in the prompt scores** — not just the target
  skill. An occurrence is a translation unit of the prompt text (a letter, a
  contraction, a digit; indicators like capitals and the number sign ride
  along with their unit and score too). Typing an occurrence earns its
  skills +2 (`CLEAN_AWARD`) when typed with **no mistake on that occurrence
  and before that occurrence's own hint was revealed**, else +1
  (`BASE_AWARD`) — typing a skill always earns at least a point, so hinted
  progress is real progress, just half as fast, and scores climb (and the
  hint delay below lengthens) even while the learner still leans on the
  hint. In "a cad ebb", every sign hinted and no mistakes, "a" scores 2
  (two occurrences), c/d/e score 1, "b" scores 2.
  Cleanliness is tracked **per occurrence** (`prompt.hintedUnits`, and
  `unitTypedClean` in `types.ts`), never per prompt: needing the hint on one
  sign costs that sign's bonus and nothing else, so a sign typed promptly
  keeps its +2 however hinted the rest of the prompt was.
- **A round's score is derived, not banked as you type** (`scoring.ts`).
  `state.scores` is a baseline, fixed for the whole prompt; what the prompt
  has earned so far is recomputed from what is on screen *now* and shown
  added to that baseline (`derivedScores`, floored at 0 per skill). Only on
  completion is it folded into `state.scores`. So a word typed correctly and
  then backspaced away — or rewritten by VoiceOver into something wrong —
  takes its points back with it, and a prompt abandoned via `nextPrompt`
  scores nothing at all.
- One mistake on an occurrence is free (it just drops that occurrence's
  award to +1); the **second mistake on the same occurrence** costs its
  skills 1 point (`MISTAKE_PENALTY`, once per occurrence however many
  mistakes follow) and reveals that occurrence's hint. Mistakes are
  *history*: backspacing the mistake away does not refund the penalty, and
  the same occurrence typed correctly afterwards nets zero (+1 award, −1
  penalty) rather than +1. A "mistake" is the
  transition from matching-prefix to diverged, charged to the occurrence at
  the caret; typing further while already diverged is the same mistake, and
  a fresh divergence after backspacing to a correct prefix is a new one.
- Hints are revealed **one sign at a time**, and each sign's countdown
  starts **when the caret reaches it** — that is, when the sign before it
  has been typed. Revealing one sign never starts the clock on the next:
  taking ten minutes over one sign costs the following sign none of its
  time. A caret sitting on a space has no countdown at all (a space unit
  bears no skill), so the first sign of a word starts its clock only once
  the space before it is typed.
- The wait is per sign, gated on *that sign's own* skills
  (`hintDelayForSkills`): a sign whose skills are all learnt never goes on
  the clock — its hint appears only via the two-mistake rule — and a sign
  still being learned waits `hintDelayMs(score)` = 400 + 300 × score ms of
  its weakest unlearnt skill, so the wait stretches as the learner's score
  on that skill grows. Earlier signs being hinted has no bearing on later
  ones.
- Core `nextHintFor(state)` (`hints.ts`) is what puts this together: it
  names the sign currently on the clock and its wait, and the state layer
  runs exactly one timer from it, calling `revealHint(state, unitIndex)`
  when it fires.
- A showing hint never dumps the whole answer: signs reveal one at a time,
  only ever at the caret. A revealed sign stays flipped in the grid's cell
  row for the rest of the prompt (covering it again would tell the learner
  nothing), while the *spoken* hint covers only the **word at the caret**
  (VoiceOver braille screen input commits whole words), and within that
  word only the signs already revealed (`hintWordForPrompt` supplies the
  word's units with their prompt-wide indexes; the live region reads their
  leading revealed run).
- Every `FOX_INTERVAL`-th prompt (50), counting from the learner's first, is
  the fox challenge — the fixed sentence `FOX_SENTENCE`, no hints ever, any
  first wrong character fails it instantly and moves on. Occurrences the
  correct prefix finishes score `FOX_AWARD` (10 = `LEARNT_THRESHOLD`) per
  skill, including those typed before a failing keystroke.

### State shapes (`types.ts`)

```ts
TutorState = Record<{
  scores: Map<string, number>;  // committed baseline; skill id -> score (missing = 0)
  promptCounter: number;        // completed prompts ever (incl. failed fox)
  prompt: Prompt | null;        // what's on screen
  seed: number;                 // PRNG seed; consumed/replaced by nextPrompt
}>
Prompt = Record<{
  text: string;                 // print text to type, matched exactly
  targetSkillId: string | null; // null for fox
  isFox: boolean;
  typed: string;                // latest typed text (or back-translated print)
  typedUnicode: string;         // chorded cells as U+2800 ('' when not chording)
  judgedByCells: boolean;       // round judged on cells, not print (see below)
  unitMistakes: Map<number, number>; // mistakes per unit index (history)
  hintedUnits: Set<number>;     // unit indexes whose hint has been revealed
  diverged: boolean;            // typed currently diverges from the text
  completed: boolean;           // finished (typed correctly, or fox failed)
  failed: boolean;              // fox only
}>
```

Factories `makeTutorState(props?)` / `makePrompt(props?)` are exported for
the state layer and tests. `unitTypedClean(prompt, unitIndex)` says whether an
correct answer can still earn the +2.

### Session flow (`session.ts`)

| function | behaviour |
|---|---|
| `startSession(seed?)` | fresh state with the first prompt generated; pass e.g. `Date.now()` for variety (defaults to 1, fully deterministic) |
| `nextPrompt(state)` | replace the current prompt with a new one (call after completion, or to skip). Serves the fox challenge when `promptCounter % FOX_INTERVAL === 0`. Consumes and refreshes `seed` |
| `keystroke(state, input)` | feed the full *result* of one input event (not a single key), as a `KeystrokeInput`: `{ kind: 'print', typed, cells? }` judges the round on the typed text (VoiceOver, and every fox run — any valid spelling of the right print is accepted, with the optional cells attributing fox awards to the signs actually chorded); `{ kind: 'cells', cells }` judges it on the chorded cells against the prompt's canonical translation (emulated regular rounds — the round drills specific braille, so right print via the wrong cells diverges; the derived print is kept for display only). Handles progressive prefix matching in the judged coordinate, mistake events, fox instant-fail, completion, and `promptCounter`. Touches `scores` only on completion, committing `derivedScores`. Ignores input once completed |
| `revealHint(state, unitIndex)` | uncover one sign's hint (state layer calls this when that sign's timer fires). No-op for fox |
| `isPromptComplete(state)` | whether to move on (then call `nextPrompt`) |
| `serialize(state)` | plain `SerializedTutorState` object, JSON-safe (versioned, `version: 1`) |
| `deserialize(obj)` | rebuild a `TutorState`; lenient about missing fields, throws `TypeError` on garbage/unknown version |

### Derived scores (`scoring.ts`)

| function | returns |
|---|---|
| `pendingScoreDeltas(state)` | `Map` of skill id -> the score change the prompt on screen would contribute if it completed as it stands |
| `derivedScores(state)` | `state.scores` plus those deltas, floored at 0 per skill — scores as the learner should see them *now* |
| `judgedPrintCaret(prompt)` | the judged caret mapped into print: the plain common-prefix caret on a print-judged round; on a cell-judged round the print end of the last unit whose cells are fully chorded. Drives the hint word, the hint timer, and the view's `matchedPrint`, so derived print past the chorded cells never reads as progress |

`session.ts` commits `derivedScores` when a prompt completes; `progress.ts`
and the view layer display it while the round runs.

### Progress views (`progress.ts`)

| function | returns |
|---|---|
| `scoreFor(state, skillId)` | committed score (0 default) |
| `isSkillLearnt(state, skillId)` | committed score >= 10 |
| `isLearntIn(scores, skillId)` / `learntSkillsIn(scores)` | the same against any score map (pass `derivedScores(state)` for the live view) |
| `learntSkills(state)` / `activeSkills(state)` | `Skill[]` in curriculum order, by *committed* score — selection deliberately ignores the round in flight so the active window does not churn mid-prompt |
| `knownSkillIds(state)` | `Set` of learnt ∪ active ids |
| `hintDelayForSkills(state, skillIds)` | ms a sign exercising these skills waits before its hint, or `null` (all learnt, or no skills at all — a space) |

### Prompt generation (`prompts.ts`, `corpus.ts`)

`generatePrompt(state, targetSkill) => { text, targetSkillId }` —
deterministic given `state.seed`. Prompts are **monkeytype-style: sequences
of 3..N real English words** (N starts at 3 and grows by one word per 15
learnt skills, up to 5), so the learner types a few words at a time from the
very first prompt; they need not be sensible sentences, but every word is real —
nonsense letter clusters are never emitted. A text is only used if its
greedy grade-2 translation succeeds **and uses only known (learnt ∪ active)
skills**, so e.g. "bed" is never asked before the "ed" groupsign is known
(a braille display would render it ⠃⠫), and capitalised words wait for the
capital indicator skill.

**Every word of a prompt — not only the one exercising the target — must
also exercise a skill currently being taught**: the active window, plus the
target itself when the prompt is a revision of a learnt skill. Otherwise
the earliest words ("bad cab") would go on padding prompts forever and most
keystrokes would drill nothing. Some windows hold nothing a plain word can
show (all digits, the capital indicators, a run of punctuation); there the
padding falls back to the words drawn from the most recently learnt skills,
so it is at least fresh revision.

Per target kind:

- **letters** and every contraction kind: a word sequence in which one word
  exercises the target. A single letter is only ever prompted alone when it
  is a real standalone word ("a"; "I" once capitals are known) — letters
  that are grade-2 wordsigns (b=but, c=can, …) never appear alone, because
  typed standalone they would translate to the contraction word.
- **digits**: digit strings (1–3 digits) containing the target digit.
- **number sign**: a known digit; if it activates before any digit is known
  (the window can be full of letters/capitals) it temporarily gets a plain
  gated word prompt until the first digit activates.
- **capitals**: a sequence in which *every* word is Capitalised
  (capital-letter-indicator, or "I") or ALL-CAPS
  (capital-word-indicator) — no plain word exercises a capital indicator,
  so lowercase padding would teach nothing.
- **punctuation/symbols**: in context — terminal marks end a word sequence
  (`bad cab.`), separators sit between words (`hat, top`), enclosures wrap
  a word (`[dog]`, `“cat”`), joiners join two (`day/if`, `cat — dog`),
  commercial/math signs use digits (`$7`, `3+4`, `5%`).

`pickTarget(state, rng)` — used internally by `nextPrompt`: usually one of
the 5 active skills; with probability 1/3 (`REVISION_PROBABILITY`, once
anything is learnt) a revision item, half uniform over learnt skills, half
from the 5 lowest-scoring learnt skills.

`corpus.ts` exports the built-in `WORDS` list (real words only, lowercase).
Every entry translates cleanly, and **every skill has at least one
generatable prompt at the moment it becomes active** (all earlier skills
learnt, 5-skill window) — both properties are enforced by tests, including
per-letter words for the earliest windows ("bad"/"cab"/"dab" when only
a–e are known).

### Aligned column grid (`columns.ts`)

`buildRowModel({ text, typed, cells, hintedUnits }) => RowModel` — the one
grid every row of the drill is laid out against: one `Column` per
translation unit of the prompt, so a contraction's three letters of print
sit under its single cell and a capital's two cells sit over its one
letter. Each column carries its print span, expected cells (U+2800),
whether its hint is revealed, the print/cells the learner has produced for
it (`null` until matched — cells count only *whole* units, the same rule
scoring judges by), and whether the caret sits on it. Whatever neither walk
can attribute to a column — a diverged tail, overflow past the prompt, a
half-chorded multi-cell sign — comes back as `extraPrint`/`extraUnicode`.
Untranslatable text degrades to a single whole-text column rather than
throwing. Pure; VoiceOver mode simply passes empty `cells`.

### Braille rendering (`braille.ts`)

| function | behaviour |
|---|---|
| `translate(text)` | greedy grade-2 translation: `{ cells, skillIds, units }`. `units` groups the cells by print span (indicators attach to the sign they precede). Throws on characters outside the curriculum |
| `textToCells(text)` / `textToUnicode(text)` | cells / U+2800 string for braille display |
| `cellCount(text)` | number of cells (spaces count as one blank cell each) |
| `dotsToUnicode(cells)` | dot-number arrays → U+2800 string |
| `hintWordForPrompt(state)` (`hints.ts`) | the caret word's braille as reveal units: `{ wordStart, units: { index, unicode }[] }`, `null` for fox/no prompt/nothing after the caret |
| `nextHintFor(state)` (`hints.ts`) | the sign whose hint is on the clock and its wait: `{ unitIndex, delayMs }`, or `null` when nothing is counting down |
| `CAPITAL_INDICATOR` | the dot-6 capital letter indicator cell |

The translator applies the canonical patterns from skills.json with
approximate positional rules (wordsigns/shortforms standalone only; strong
and initial-letter contractions anywhere; "ing" and final-letter groupsigns
never word-initial; ea/bb/cc/ff/gg strictly interior; be/con/dis word-initial
with ≥ 3 letters following; en/in anywhere; number sign before digit runs).
Capitalisation uses the capital skills: one `capital-letter-indicator` cell
per capital letter, or a single `capital-word-indicator` (⠠⠠) before an
ALL-CAPS word — both appear in `skillIds`, so gating counts them. It is
deliberately not liblouis — good enough for hints, prompt gating, and the
fox minimum, per the caveats below.

### Back-translation (`backtranslate.ts`)

The inverse of `translate`, used when the learner chords braille directly on a
QWERTY keyboard (VoiceOver mode off — see the state layer). A cell's meaning is
contextual, so decoding is word-buffered and progressive.

| function | behaviour |
|---|---|
| `backTranslateWord(cells, { expected?, final? })` | decode one word's cells (no blanks) to print; always returns a string |
| `backTranslateBuffer(cells, expectedText)` | decode a whole prompt buffer (blank cells mark spaces) against the prompt text |
| `backTranslateBufferAttributed(cells, expectedText)` | as `backTranslateBuffer`, but also returns the decoded signs as translation units over the derived text — the skills the learner *actually* chorded. The state layer passes these to `keystroke` on fox runs so the challenge credits what was typed, not the canonical solution's contractions |

Two strategies combine. Given the `expected` prompt word, the buffer is matched
cell-by-cell against `translate(expected).cells`/`.units` and the matching print
span is emitted — so a correctly-typed prefix shows the matching print prefix
(no phantom mistakes) and a full match round-trips exactly. The **round-trip
property `backTranslateBuffer(translate(text).cells, text) === text` holds for
every promptable text** (corpus words, capitalised/ALL-CAPS forms, digit
strings, punctuation-in-context, the fox sentence), enforced by a generated test
universe, and it depends only on this matching — not on the canonical decoder.
The diverged tail (a wrong chord), text with no expected context, and extra
words are decoded by a greedy context-free decoder that mirrors `translate`'s
rules (capitals, standalone signs, number mode, positional in-word signs with an
open-word lookahead waiver). It never throws; cells it cannot read become their
U+2800 glyph, which never matches prompt text, so a mistake stays visible.

### fox challenge (`fox.ts`)

- `FOX_SENTENCE` — `The quick brown fox jumps over the lazy dog.` ("jumps",
  not "jumped": the perfect pangram lets an uncontracted run exercise the
  whole alphabet)
- `FOX_MIN_CELLS` — minimum grade-2 cell count, derived from the skills data
  at module load. It is **36**, not the 39 sketched in early planning:
  "quick" is itself a UEB shortform (⠟⠅, 2 cells rather than 5).
  Breakdown: The 2, quick 2, brown 4, fox 3, jumps 5, over 3, the 1,
  lazy 4, dog 3, period 1, spaces 8.
- `foxResult(cellsTyped)` — for a flawless run, `{ kind: 'crown' }` at
  exactly the minimum, else `{ kind: 'badge', percentAbove }` (percentage
  above minimum, unrounded); counts below the minimum (or non-finite) are
  `{ kind: 'failed' }`. The state layer counts cells typed (input insertion
  events) and reports the number; a run that hit a wrong character is
  already failed by `keystroke` without consulting this.
- `expectedSignAt(text, typed)` — the whole translation unit due where
  `typed` stopped agreeing with `text`, as `{ unicode, print }`. Whole units,
  so a contraction is named as itself (⠪ "ow", not ⠕ then ⠺); a caret on a
  space yields the blank cell rather than the word after it.
- `divergentCells(buffer, text)` — the tail of a chord-mode cell buffer that
  `text` no longer accepts. Found by re-deriving print from growing prefixes
  of the buffer, *not* by diffing against the canonical translation: chording
  a word out letter by letter is correct print at a higher cell cost, which
  the challenge grades separately rather than failing.

Together these drive the failure screen (`AppViewModel.foxFailure`), which
shows the sign that was owed and — in chord mode only — the cells actually
entered. VoiceOver braille screen input hands the app print rather than the
cells behind it, so there "what you typed" would only echo the app's own
translation back as if it were the learner's input; that row is omitted.

### Determinism & persistence

All randomness flows through the `seed` field (mulberry32). Same serialized
state ⇒ same future prompts. `serialize`/`deserialize` round-trip through
`JSON.stringify`/`parse` for localStorage (phase 3).

## State layer (`src/state`)

Everything impure that isn't rendering: event handling, timers, and storage.
The UI never calls core transitions directly.

### `TutorStore` (`store.ts`)

A tiny subscribe/notify store (no reducer indirection — methods dispatch
straight to core transition functions and call `notify()`):

- `viewModel(): AppViewModel` — a plain-data snapshot of everything the UI
  renders (prompt/typed/diverged, hint unicode, active skills with scores,
  per-group progress, best fox, fox failure detail, reset-confirm flag, …).
  Built by `view.ts` from the core's read-only views. The failure detail also
  draws on the store's chord-mode `cellBuffer`, which is the only record of
  the cells a learner actually pressed.
- `handlers: AppHandlers` — a stable object of DOM event handlers the UI
  wires up: `onInput`, `onFoxContinue`, `onResetRequest/Confirm/Cancel`.
- `subscribe(listener)` — `main.ts` subscribes and re-renders the React
  root with a fresh view model on every change.

**Input capture.** The drill input is a real, **uncontrolled** and **visible**
`<input type="text">` (required so macOS VoiceOver braille screen input works
— raw keydown is never the only path). It is uncontrolled on purpose:
VoiceOver owns the field's value and the app never writes it back mid-prompt,
because rewriting a controlled `value` during a word commit desyncs
VoiceOver's word buffer and can leave a slip unrecoverable. The field only
*remounts* — clearing itself — when the store-owned `promptKey` epoch changes
at a genuine prompt change. It is shown (not visually hidden) so the learner
can see exactly what VoiceOver put in the DOM; if VoiceOver mangles or
reorders a word, they can see it and clear/retype to recover. `onInput`
(wired to React's `onChange`, i.e. the DOM `input` event) reads the field's
full current value, runs it through `normalizeTypedValue` (a **read-only**
comparison normalisation — drops a stray leading space, collapses VoiceOver's
doubled spaces, tolerates the trailing space at a word/sentence commit; it
never touches the field), and feeds the result to core `keystroke`. Note the
consequence of a visible field plus that normalisation: the raw value on
screen and the coloured prompt can disagree about spacing — the field shows
what VoiceOver actually produced, while the colouring follows the normalised
`typed`. For fox cell counting, each input event whose `inputType` starts with
`insert` counts as **one cell** (VoiceOver commits a whole contraction as a
single insertion; a keypress inserts one char); deletions never decrement. On
a flawless fox completion the count goes to core `foxResult`; the best
crown/badge result is kept (crown beats badge, lower `percentAbove` beats
higher) and persisted.

**Chord input (VoiceOver mode off).** A header switch toggles `voiceOverInput`
(default on = the behaviour above; persisted). When off, the learner types
braille chords on the QWERTY home row and the store, not the OS, does the
translation. `chords.ts` is a pure chord state machine keyed on
`KeyboardEvent.code` — `f d s a j k l ;` → dots `1 2 3 7 4 5 6 8`; a chord
commits when all held keys are released (Perkins convention); a chord containing
dot 7/8, or space mixed with dots, is discarded. The store's `onDrillKeyDown`/
`onDrillKeyUp` (wired to the same real `<input>`, which stays focusable so the
control is unchanged for assistive tech) preventDefault the chord keys, Enter,
and stray printables, and append each committed cell to a per-prompt
`cellBuffer` (blank cells mark spaces). After every commit the buffer goes to
`keystroke`, and **how the round is judged splits by prompt** (`bufferInput`):

- **Regular prompts are judged on the cells** (`{ kind: 'cells' }`): the
  prompt drills a specific sign, so falling back to an uncontracted spelling
  is a mistake even though it derives the right print. The core still keeps
  the derived print (via `backTranslateBuffer`) for display, but divergence,
  mistake charging, and hints all follow the canonical cells; the view's
  `matchedPrint` (core `judgedPrintCaret`) stops the prompt painting derived
  print as correct while the cells are off canon, `divergedText` (core
  `divergedTail`) renders the unaccepted cells themselves in red at the
  caret (derived print cannot place a cell mistake, and can even be shorter
  than the accepted print), and the two-mistake hint reveals the cells being
  asked for.
- **fox runs are judged on print** (`{ kind: 'print' }`, cells riding along):
  any valid grade-1/grade-2 spelling of the sentence is acceptable — spelling
  a shortform out is correct print at a higher cell cost, which the cell-count
  grading handles — and the attached cells let scoring credit the signs
  actually chorded.
- **VoiceOver mode is print-judged everywhere**: the OS hands the app print;
  there are no cells to judge.

Backspace pops the last cell. `handleInput` short-circuits while chord mode is
on, and the key handlers no-op while it is off. Toggling mid-prompt (or
resuming a persisted chord-mode session) restores the exact chorded buffer
when the core holds one, or reconstructs one from a clean typed prefix — but
on a cell-judged round only a buffer that is a prefix of the canonical cells
resumes (anything else would resume pre-diverged, charging a mistake the
learner is not making now); otherwise the prompt restarts cleanly. For fox
cell counting each committed chord (cell **or** space) counts as one cell;
Backspace never decrements — so chording the canonical 36 cells earns the
crown and spelling a shortform out costs extra.

**Hint timer.** A single `setTimeout`, driven by core `nextHintFor(state)`,
which names the sign on the clock (always the one at the caret) and its
wait. After every state change the store compares that sign against the one
its running timer is for — keyed `promptEpoch|unitIndex`, so a new prompt
never inherits the previous one's clock — and **re-arms only when the sign
changes**, i.e. when the caret moves. That is what makes a sign's countdown
start on arrival rather than chaining off the previous reveal: while the
caret stays put, the running clock is left alone; once the caret's sign has
been revealed `nextHintFor` returns null and nothing counts down until the
caret moves on. When the timer fires it dispatches `revealHint(state,
unitIndex)`. The revealed set lives in the core, so it persists across a
reload rather than being store-local.

**Persistence (`persistence.ts`).** A versioned envelope
(`qbf-progress-v1`) in localStorage: `{ version, tutor: serialize(state),
bestQbf, voiceOverInput }` — the key and field names predate the "fox
challenge" naming and are kept so existing progress survives. `voiceOverInput` was added
later as an optional field (no version bump): an absent/garbage value loads as
`true`, so older envelopes keep the original behaviour. Saves are debounced
(250 ms) after every
change and flushed on `pagehide`. On boot: absent/corrupt/unknown-version
data ⇒ fresh `startSession(Date.now())`; an in-flight prompt resumes as-is;
a completed prompt (or half-typed fox, whose cell count wasn't persisted)
moves on via `nextPrompt`. "Reset progress" (confirm step in the UI) clears
storage and starts over.

A "New skill" introduction banner used to live here, keyed on
`introducedSkillIds` (every skill that had ever been a prompt *target*). It
was removed: skills are used in prompt text — and score points — from the
moment they enter the active window, which is long before they are randomly
picked as a target, so the banner announced skills as "new" after the learner
had already been drilling them. The "Learning now" panel already shows all
five active skills with cells, print, and score, continuously. Envelopes
written by older versions still carry `introducedSkillIds`; the loader
ignores unknown fields, so no version bump was needed.

## UI (`src/ui`)

Pure render functions of `AppViewModel` + `AppHandlers` (both defined in
`src/state/view.ts`; dependency direction stays ui → state → core). No JSX;
every component uses `createElement as e`. No component owns state, timers,
or effects — `main.ts` re-renders the root on every store notification.

- `app.ts` — layout: header, drill view, skill panel.
- `header.ts` — the logo: "Quick braille fox" as a 3×3 grid of braille
  cells, one word per row — ⠠⠟⠅ (capital sign + shortform "qk"), ⠃⠗⠇
  (shortform "brl"), ⠋⠕⠭ ("fox" in full) — with aria-label "Quick Braille
  Fox"; the input-mode switch (`role="switch"`, "VoiceOver input", on by
  default), the persisted best fox result (👑 or `+N%`), and the two-step
  reset-progress control.
- `drill.ts` — the prompt as the **aligned column grid** (`vm.rows`, core
  `buildRowModel`): one tinted column per translation unit, words wrapping
  as a unit and every space its own column (a space is a cell the learner
  must enter). Each column stacks the expected cells over the target print
  — the cells start as blank placeholder cells, so the learner always sees
  how many cells each sign costs, and flip to the real dots when that
  sign's hint reveals — and, in emulated mode only, two further rows: the
  print the learner's cells produced and the cells themselves. The
  alternating column tint (unit-index parity, `col-even`/`col-odd`) is what
  visually ties one sign's cells to its print across rows: one cell over a
  whole word for a wordsign, two cells over one letter for a capital. The
  print row keeps the monkeytype colouring (correct prefix / wrong /
  untyped, plus a caret); diverged positions show what was actually
  produced — mistyped print, or on a cell-judged round the offending cells
  as braille glyphs — so a mistake is visible as what it was (backspacing
  restores the target chars). All of it wrapped in a `<label>` for the
  autofocused monospace input (which also carries the chord-mode
  `onKeyDown`/`onKeyUp` handlers; in VoiceOver mode the raw field doubles
  as the produced-print row). The **fox challenge deliberately keeps the
  flat coloured prompt**: its placeholder cells would reveal how far each
  word contracts, which is exactly what the no-hints challenge grades you
  on knowing. Spoken/braille-display parity: the prompt announcement names
  the prompt's total cell count (what the placeholder row shows sighted
  users), the grid itself is aria-hidden behind the visually-hidden prompt
  text, and hint reveals reach a visually-hidden `aria-live=polite` region
  as spoken dots plus the raw glyphs. The fox result screen is unchanged
  (crown / `+N%` badge / failed, with a Continue button).
- `skills.ts` — the 5 active skills (cells, print, score bar toward 10) and
  overall/per-group progress.
- `braille.ts` — `BrailleCells`: renders a U+2800 string as large,
  individually boxed cells. The braille characters stay accessible (not
  aria-hidden) on purpose: a connected braille display renders them as
  real dots, which is exactly what a hint should do.
- `styles.css` — warm, clean, modern, soft. A cream/terracotta light theme
  is the primary look, with a warm-dark (charcoal/brown) variant via
  `prefers-color-scheme: dark`; all tokens are CSS custom properties on
  `:root`. Soft = rounded corners and gentle warm-tinted shadows instead of
  hard borders, with transitions disabled under `prefers-reduced-motion`.
  Every text/background pair holds WCAG AA (the deliberately dim untyped
  prompt chars are large text, ≥ 3:1), and wrong chars keep an underline so
  the monkeytype colouring never relies on hue alone. Responsive: CSS grid
  collapses to one column under 52rem; `100dvh` keeps the input visible
  with the on-screen keyboard up; no horizontal page scroll.

Rendering tests (`app.test.ts`) render the full App through
`react-dom/server` for the fresh-session, hint-showing, fox-challenge, and
fox-result states.

## Table-parsing caveats (for future phases)

- **Question mark**: the macOS forward rule is `punctuation ? 56-236`, where
  dots 56 is the grade-1 indicator (needed because a bare 236 reads as an
  opening quote in grade 2 context). The symbol itself is 236, which is what
  we teach; the generator has an explicit override matching the table's own
  back-translation rule.
- **Double quote** (`"`) is the *nonspecific* quote 6-2356. The directional
  Unicode quotes “ ” ‘ ’ are separate skills in the `symbols` group (the
  ASCII `"` never back-translates to them).
- **Digits look like letters**: digit cells equal a–j cells; only the
  preceding number sign distinguishes them. Any quiz rendering digits should
  show/require the number sign.
- **Contractions are context-dependent.** skills.json holds each sign's
  canonical pattern only. When later phases translate whole words/sentences,
  they must not naively substitute: usage rules (wordsigns stand alone;
  lower signs can't touch punctuation on both sides; "in"/"en" restrictions;
  bb/cc/ff/gg are midword-only; shortforms have standalone rules) live in
  the g2 table's thousands of `match`/exception rules. For full-text
  translation, drive liblouis itself rather than reimplementing.
- **`be`, `there`, `those`** have no simple one-line rule in the g2 table —
  only `match` rules. The generator handles this; keep it in mind if adding
  strings to the curated lists.
- **Capitalisation is taught**: the capital letter indicator (dot 6) and
  capital word indicator (⠠⠠) are their own skills in the `capitals` group.
  Other pure translation mechanics (the grade-1 indicator, `seq` rules,
  `attribute` declarations, `noback pass2` fixups, `endcapsword`) remain
  deliberately excluded.
- The dots operand grammar allows `=` ("spell out, no contraction"),
  virtual-dot suffixes (`46-15b`), and dots 7/8; the generator rejects all
  of these as "not a teachable 6-dot pattern".
