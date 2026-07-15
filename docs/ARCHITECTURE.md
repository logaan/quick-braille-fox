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
  main.ts                   bootstraps React root
  core/                     pure domain logic (no DOM, no React, no I/O)
  state/                    state management + persistence (Immutable.js)
  ui/                       presentation; createElement only, no JSX
  data/
    skills.json             GENERATED curriculum data (committed)
    skills.ts               types + typed export of skills.json
scripts/
  copy-braille-tables.sh    copies liblouis tables from macOS into data/
  generate-skills.mjs       parses data/ tables -> src/data/skills.json
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
- `data/en-ueb-g1.ctb`: `numsign 3456` (the numeric indicator).
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
  if built-in sanity checks fail ("a"=1, "and"=12346, "ing"=346, "the"=2346,
  numsign=3456, "be"=23, "there"=5-2346, "ance"=46-15, "about"=1-12).

## Skill record format

`src/data/skills.json` is a flat array, already in curriculum order:

```ts
interface Skill {
  id: string;        // stable unique id, e.g. "letter-a", "groupsign-ing",
                     // "initial-day", "shortform-about", "punct-comma"
  kind: SkillKind;   // "letter" | "number" | "number-sign" | "punctuation"
                     // | "wordsign" | "contraction" | "groupsign"
                     // | "lowersign" | "initial-letter" | "final-letter"
                     // | "shortform"
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

### Curriculum groups, in order (228 skills total)

| group | count | contents |
|---|---|---|
| `letters` | 26 | a–z, alphabetical |
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

## Table-parsing caveats (for future phases)

- **Question mark**: the macOS forward rule is `punctuation ? 56-236`, where
  dots 56 is the grade-1 indicator (needed because a bare 236 reads as an
  opening quote in grade 2 context). The symbol itself is 236, which is what
  we teach; the generator has an explicit override matching the table's own
  back-translation rule.
- **Double quote** is the *nonspecific* quote 6-2356. Directional quotes
  (open 236 / close 356) are context-dependent `match` rules we don't teach
  yet.
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
- **Capitalisation is untaught mechanics** so far: the capital indicator
  (dot 6) etc. are deliberately excluded, as are other pure translation
  mechanics (`seq` rules, `attribute` declarations, `noback pass2` fixups).
- The dots operand grammar allows `=` ("spell out, no contraction"),
  virtual-dot suffixes (`46-15b`), and dots 7/8; the generator rejects all
  of these as "not a teachable 6-dot pattern".
