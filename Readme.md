# Quick Braille Fox

> ⠠⠟⠅
> ⠃⠗⠇
> ⠋⠕⠭

The logo spells "Quick braille fox" as a 3×3 grid of braille cells, one word
per row: the capital sign + the shortform "qk", the shortform "brl", and
"fox" in full. In the app those nine cells are drawn as a single 6×9 field of
dots rather than nine boxed glyphs.

Quick Braille Fox is a web app that teaches you to type Unified English Braille — grade 1
(uncontracted) first, then grade 2 (contractions and shortforms). It drills
258 skills, five at a time, monkeytype-style: type the printed prompt,
where every sign carries blank placeholder cells showing how many braille
cells it expects — and if you hesitate or slip twice they flip over to
show the answer. Learnt
skills come back for revision, and every dot pattern is taken from the
liblouis tables that macOS VoiceOver ships, so what you learn matches what a
Mac actually produces. A real text field receives all typing, so VoiceOver
braille screen input works throughout.

Two input modes, two ways of judging. In VoiceOver mode the OS hands the app
print, so prompts are judged on the text you produce. In emulated mode
(braille chords on the QWERTY home row) regular prompts are judged on the
*cells* you chord: each prompt drills a specific sign, so spelling a
contraction out letter by letter counts as a mistake even though it reads the
same in print — the hint then shows the cells being asked for. Only the fox
challenge accepts any valid grade-1/grade-2 spelling; there, efficiency is
what the cell count grades.

Every 50th prompt — starting with your very first — is the fox challenge:
type "The quick brown fox jumps over the lazy dog." flawlessly, with no
hints and instant failure on any wrong character. Its rules are shown on
screen for the whole round. Every skill you type correctly there scores 10
points, enough to learn it outright, since you have demonstrated it cold.
Your insertion count is compared with the 36-cell grade 2 minimum —
committing contractions means fewer insertions — and a perfect minimum-cell
run earns a crown. Progress persists in the browser (localStorage).

## Braille displays and screen readers

Hints and cell displays are literal braille characters (the U+2800 block) —
a connected braille display shows exactly the dots on screen, whatever
output table you use. Your grade-2/contracted setting compresses the
surrounding text but cannot alter the hint cells, because the liblouis
tables VoiceOver and NVDA ship pass every braille-pattern character through
dot for dot. (JAWS uses its own translator by default; passthrough there is
expected but not yet verified — see `docs/braille-display-testing.md` for
the manual test matrix.)

The drill keeps a persistent status line directly under the input — current
position, or where typing went wrong — because live-region messages tend to
flash or vanish on braille displays. Announcements themselves carry only
their variable facts — `2: <prompt> — 9 cells.`, `wrong at 12: d` — with no
fixed prefix and no boilerplate tail, because a word repeated on every prompt
is a pan of a short line repeated on every prompt. Explanation lives where it
is read once rather than per event: the fox rules, on screen for the whole
round, and the detail under a fox result.

## Commands

Every common task is a script:

| Script | What it does |
| --- | --- |
| `./scripts/dev.sh` | Start the Vite dev server |
| `./scripts/test.sh` | Run the test suite once (vitest) |
| `./scripts/typecheck.sh` | Typecheck the project (`tsc --noEmit`) |
| `./scripts/build.sh` | Typecheck and build the production bundle into `dist/` |
| `./scripts/preview.sh` | Serve the production build locally |
| `./scripts/generate-skills.sh` | Regenerate `src/data/skills.json` (copies the macOS braille tables into `data/` first if missing) |
| `./scripts/copy-braille-tables.sh` | Copy the liblouis UEB tables from macOS into `data/` |
