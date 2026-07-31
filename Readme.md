# Quick Braille Fox

> ⠠⠟⠅
> ⠃⠗⠇
> ⠋⠕⠭

The logo spells "Quick braille fox" as a 3×3 grid of braille cells, one word
per row: the capital sign + the shortform "qk", the shortform "brl", and
"fox" in full.

Quick Braille Fox is a web app that teaches you to type Unified English Braille — grade 1
(uncontracted) first, then grade 2 (contractions and shortforms). It drills
258 skills, five at a time, monkeytype-style: type the printed prompt, and
if you hesitate or slip twice the answer appears as braille cells. Learnt
skills come back for revision, and every dot pattern is taken from the
liblouis tables that macOS VoiceOver ships, so what you learn matches what a
Mac actually produces. A real text field receives all typing, so VoiceOver
braille screen input works throughout.

Every 50th prompt — starting with your very first — is the fox challenge:
type "The quick brown fox jumps over the lazy dog." flawlessly, with no
hints and instant failure on any wrong character. Its rules are shown on
screen for the whole round. Every skill you type correctly there scores 10
points, enough to learn it outright, since you have demonstrated it cold.
Your insertion count is compared with the 36-cell grade 2 minimum —
committing contractions means fewer insertions — and a perfect minimum-cell
run earns a crown. Progress persists in the browser (localStorage).

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

Design details live in `docs/ARCHITECTURE.md`.
