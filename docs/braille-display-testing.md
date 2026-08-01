# Braille display manual test matrix

The app renders hints and cell rows as literal U+2800 braille characters, on
the assumption that a connected refreshable braille display shows them
dot-for-dot regardless of the user's output-table settings.

## What is already established

- The liblouis tables this app is built from prove passthrough at the table
  level: `data/en-ueb-g2.ctb` includes `en-ueb-g1.ctb`, which includes
  `braille-patterns.cti`, mapping every U+2800-block character to its own dot
  pattern via `noback sign` rules. This covers both contracted and
  uncontracted output settings.
- VoiceOver (macOS/iOS) ships exactly these tables; NVDA uses liblouis (per
  the NVDA User Guide). So passthrough is expected on both.
- JAWS uses its own English braille translator by default, **not** liblouis —
  passthrough is plausible but unverified by any primary source we found.

## Matrix to run on real hardware

Braille viewers are imperfect proxies (Roselli,
adrianroselli.com/2023/01/jaws-nvda-and-voiceover-braille-viewers.html), so
each cell below wants a real display. For each combination check:

1. **Hint cells** — the hint under the drill shows the exact dots the cells
   claim (compare against the on-screen dot pattern).
2. **Fox failure rows** — Expected/You-typed rows likewise.
3. **Per-cell spans** — each glyph is wrapped in its own `span`
   (`BrailleCells`); confirm no browser/AT pairing introduces separators
   between cells.
4. **Speech voicing of raw glyphs** — with speech on, note whether U+2800
   glyphs are silent, read as "braille pattern dots-x" per character, or
   something else (this decides whether the raw cells need hiding from
   speech via a future `aria-braillelabel` layer).
5. **Status line** — the line under the input is reachable by panning down
   from the focused input and re-readable at any time.
6. **Fox result focus** — when a fox run ends, the display shows the outcome
   summary line (not "Continue btn").

| Screen reader | Display | Output mode | Hint cells | Failure rows | Separators | Speech voicing | Status line | Result focus |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| VoiceOver macOS | | contracted (grade 2) | | | | | | |
| VoiceOver macOS | | uncontracted (grade 1) | | | | | | |
| VoiceOver macOS | | 8-dot computer braille | | | | | | |
| VoiceOver iOS | | contracted | | | | | | |
| VoiceOver iOS | | uncontracted | | | | | | |
| NVDA | | liblouis UEB grade 2 | | | | | | |
| NVDA | | liblouis UEB grade 1 | | | | | | |
| NVDA | | 8-dot computer braille | | | | | | |
| JAWS | | default English translator | | | | | | |
| JAWS | | computer braille | | | | | | |

## If JAWS fails passthrough

The fallback is `aria-braillelabel` carrying the cells: ARIA 1.3 explicitly
permits Unicode braille patterns there for exact presentation, and
OpenAccess.nz's tests (openaccess.nz/blog/aria-braille-accessibility-support-tests/)
found Safari/VoiceOver and JAWS honour it (NVDA and Firefox do not — so the
raw-glyph content must stay the baseline). The same layer could remove the
redundant dots narration from braille output on supporting stacks; its
interaction with live regions is untested anywhere we could find, so it
belongs in the same manual pass.
