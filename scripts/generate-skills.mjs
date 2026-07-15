#!/usr/bin/env node
// Generate src/data/skills.json from the liblouis UEB tables in data/.
//
// Ground truth is the set of tables macOS VoiceOver ships (copied into data/
// by scripts/copy-braille-tables.sh). This script parses:
//
//   data/en-ueb-chardefs.uti  (+ its `include`d sub-tables) — grade 1:
//     letters (`lowercase`), digits (`litdigit`, i.e. UEB "upper" numbers),
//     punctuation (`punctuation`).
//   data/en-ueb-g1.ctb — the numeric indicator (`numsign`).
//   data/en-ueb-g2.ctb — grade 2 contractions. The table is a full
//     translation ruleset (thousands of exception rules), so we extract a
//     curated, learnable set of print strings and look each one's canonical
//     dot pattern up in the table rather than emitting every rule.
//
// Output records: { id, kind, print, dots, unicode, group, order }
//   dots:    array of cells; each cell an array of dot numbers (1..6).
//   unicode: U+2800-block string; dot n sets bit 1 << (n - 1).
//
// Plain Node, no dependencies. Run via `npm run generate`.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');
const OUT = join(ROOT, 'src', 'data', 'skills.json');

// ---------------------------------------------------------------------------
// Low-level liblouis parsing helpers
// ---------------------------------------------------------------------------

/** Decode a liblouis character operand: \xHHHH, \s, \t, \\, or a literal. */
function unescapeChar(token) {
  if (!token.startsWith('\\')) return token;
  const hex = /^\\x([0-9a-fA-F]{4})$/.exec(token);
  if (hex) return String.fromCodePoint(parseInt(hex[1], 16));
  const simple = { '\\s': ' ', '\\t': '\t', '\\\\': '\\', '\\e': '\x1b' };
  return simple[token] ?? token;
}

/**
 * Parse a dots operand like "2346" or "5-126" (cells joined with "-") into
 * an array of cells (arrays of dot numbers). Returns null for anything that
 * is not a plain 6-dot pattern (e.g. "=", virtual dots like "46-15b", or
 * 8-dot patterns), so callers can reject non-teachable rules.
 */
function parseDots(token) {
  const cells = token.split('-');
  const result = [];
  for (const cell of cells) {
    if (!/^[1-6]+$/.test(cell)) return null;
    const dots = [...new Set([...cell].map(Number))].sort((a, b) => a - b);
    result.push(dots);
  }
  return result;
}

/** Unicode braille for a dots array: dot n sets bit 1 << (n - 1). */
function dotsToUnicode(dots) {
  return dots
    .map((cell) =>
      String.fromCodePoint(0x2800 + cell.reduce((mask, d) => mask | (1 << (d - 1)), 0)),
    )
    .join('');
}

/** Read a table file, following `include` directives (within data/ only). */
function readTableLines(filename, seen = new Set()) {
  const path = join(DATA, filename);
  if (seen.has(filename) || !existsSync(path)) return [];
  seen.add(filename);
  const lines = [];
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const tokens = line.split(/\s+/);
    if (tokens[0] === 'include' && tokens[1]) {
      lines.push(...readTableLines(tokens[1], seen));
    } else {
      lines.push(tokens);
    }
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Grade 1: chardefs (letters, digits, punctuation) + g1 (number sign)
// ---------------------------------------------------------------------------

const chardefLines = readTableLines('en-ueb-chardefs.uti');
const g1Lines = readTableLines('en-ueb-g1.ctb');
const g2Lines = readTableLines('en-ueb-g2.ctb');

/**
 * First rule `opcode <char> <dots>` for any of the given opcodes +
 * character. A `noback` prefix is tolerated (forward dots are still the
 * canonical print form; some chars — en dash, smart single quotes — are
 * only defined that way).
 */
function findCharRule(lines, opcodes, char) {
  for (const original of lines) {
    let tokens = original;
    if (tokens[0] === 'noback') tokens = tokens.slice(1);
    if (!opcodes.includes(tokens[0]) || tokens.length < 3) continue;
    if (unescapeChar(tokens[1]) !== char) continue;
    const dots = parseDots(tokens[2]);
    if (dots) return dots;
  }
  return null;
}

/** First rule `opcode <dots>` (e.g. `capsletter 6`, `numsign 3456`). */
function findOpcodeDots(lines, opcode) {
  for (const tokens of lines) {
    if (tokens[0] === opcode && tokens[1]) {
      const dots = parseDots(tokens[1]);
      if (dots) return dots;
    }
  }
  return null;
}

const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');
const DIGITS = '0123456789'.split('');

// Punctuation curriculum, in teaching order. `?` needs an override: the
// forward rule in the macOS table is `punctuation ? 56-236`, but dots 56 is
// the grade-1 indicator (translation mechanics, required because a bare 236
// reads as an opening quote in grade 2). The question-mark symbol itself is
// 236, which is what the table's own back-translation rule
// (`nofor punctuation ? 236`) says.
const PUNCTUATION = [
  { char: '.', name: 'period' },
  { char: ',', name: 'comma' },
  { char: ';', name: 'semicolon' },
  { char: ':', name: 'colon' },
  { char: '?', name: 'question-mark', dotsOverride: [[2, 3, 6]] },
  { char: '!', name: 'exclamation-mark' },
  { char: "'", name: 'apostrophe' },
  { char: '"', name: 'quote' },
  { char: '-', name: 'hyphen' },
  { char: '(', name: 'open-paren' },
  { char: ')', name: 'close-paren' },
];

// The rest of the practical symbol set: everything a person typing English
// on macOS is likely to produce (brackets, slash, dashes, smart quotes,
// ellipsis, commercial signs, basic math). These are chardef `punctuation`,
// `sign`, or `math` rules. Pure translation mechanics (grade-1 indicator,
// seq rules) and non-English characters stay excluded. Taught last, as
// their own `symbols` group.
const SYMBOLS = [
  { char: '[', name: 'open-bracket' },
  { char: ']', name: 'close-bracket' },
  { char: '{', name: 'open-brace' },
  { char: '}', name: 'close-brace' },
  { char: '/', name: 'slash' },
  { char: '\\', name: 'backslash' },
  { char: '–', name: 'en-dash' },
  { char: '—', name: 'em-dash' },
  { char: '‘', name: 'open-single-quote' },
  { char: '’', name: 'close-single-quote' },
  { char: '“', name: 'open-double-quote' },
  { char: '”', name: 'close-double-quote' },
  { char: '…', name: 'ellipsis' },
  { char: '@', name: 'at-sign' },
  { char: '&', name: 'ampersand' },
  { char: '*', name: 'asterisk' },
  { char: '#', name: 'hash' },
  { char: '$', name: 'dollar' },
  { char: '%', name: 'percent' },
  { char: '_', name: 'underscore' },
  { char: '|', name: 'vertical-bar' },
  { char: '+', name: 'plus' },
  { char: '=', name: 'equals' },
  { char: '<', name: 'less-than' },
  { char: '>', name: 'greater-than' },
  { char: '~', name: 'tilde' },
  { char: '^', name: 'caret' },
  { char: '`', name: 'backtick' },
];

// ---------------------------------------------------------------------------
// Grade 2: curated print strings, dot patterns looked up in en-ueb-g2.ctb
// ---------------------------------------------------------------------------

// Rule shapes we trust as canonical definitions:
//   - `[nofor] <opcode> <print> <dots>` — plain rules and the table's clean
//     back-translation listings (wordsigns, lower signs, ing, final-letter
//     groupsigns, strong contractions/groupsigns, initial-letter words).
//   - `[empmatchafter] match <pre> <print> <post> <dots>` — context rules
//     ("be", "there", "those" and the shortforms only appear this way).
// Among candidates the shortest dot pattern wins (the table also spells the
// same strings out letter-by-letter in exception rules, e.g.
// `always enough 26-1256-126` vs the wordsign `nofor lowword enough 26`;
// the contraction is always the shortest form). Ties keep file order.
const SIMPLE_OPCODES = new Set([
  'word',
  'always',
  'begword',
  'endword',
  'midword',
  'partword',
  'lowword',
  'begmidword',
  'midendword',
  'sufword',
  'prfword',
]);

function lookupContraction(print) {
  let best = null;
  for (const original of g2Lines) {
    let tokens = original;
    if (tokens[0] === 'noback') continue; // forward-only pass hacks, never definitions
    if (tokens[0] === 'nofor') tokens = tokens.slice(1);
    if (tokens[0] === 'empmatchafter') tokens = tokens.slice(1);

    let dotsToken = null;
    if (SIMPLE_OPCODES.has(tokens[0]) && tokens[1] === print && tokens[2]) {
      dotsToken = tokens[2];
    } else if (tokens[0] === 'match' && tokens[2] === print && tokens[4]) {
      dotsToken = tokens[4];
    }
    if (dotsToken === null) continue;
    const dots = parseDots(dotsToken);
    if (dots !== null && (best === null || dots.length < best.length)) {
      best = dots;
    }
  }
  return best;
}

const ALPHABETIC_WORDSIGNS = [
  'but', 'can', 'do', 'every', 'from', 'go', 'have', 'it', 'just',
  'knowledge', 'like', 'more', 'not', 'people', 'quite', 'rather', 'so',
  'that', 'us', 'very', 'will', 'you', 'as',
];

const STRONG_CONTRACTIONS = ['and', 'for', 'of', 'the', 'with'];

const STRONG_WORDSIGNS = ['child', 'shall', 'this', 'which', 'out', 'still'];

const STRONG_GROUPSIGNS = [
  'ch', 'gh', 'sh', 'th', 'wh', 'ed', 'er', 'ou', 'ow', 'st', 'ar', 'ing',
];

const LOWER_SIGNS = [
  'ea', 'bb', 'cc', 'ff', 'gg', 'be', 'con', 'dis', 'en', 'in',
  'enough', 'his', 'was', 'were',
];

const INITIAL_LETTER_CONTRACTIONS = [
  // dot 5
  'day', 'ever', 'father', 'here', 'know', 'lord', 'mother', 'name', 'one',
  'part', 'question', 'right', 'some', 'time', 'under', 'work', 'young',
  'character', 'through', 'where', 'ought', 'there',
  // dots 45
  'these', 'those', 'upon', 'whose', 'word',
  // dots 456
  'cannot', 'had', 'many', 'spirit', 'their', 'world',
];

const FINAL_LETTER_GROUPSIGNS = [
  'ound', 'ance', 'sion', 'less', 'ount',
  'ence', 'ong', 'ful', 'tion', 'ness', 'ment', 'ity',
];

const SHORTFORMS = [
  'about', 'above', 'according', 'across', 'after', 'afternoon', 'afterward',
  'again', 'against', 'almost', 'already', 'also', 'although', 'altogether',
  'always', 'because', 'before', 'behind', 'below', 'beneath', 'beside',
  'between', 'beyond', 'blind', 'braille', 'children', 'conceive',
  'conceiving', 'could', 'deceive', 'deceiving', 'declare', 'declaring',
  'either', 'first', 'friend', 'good', 'great', 'herself', 'him', 'himself',
  'immediate', 'its', 'itself', 'letter', 'little', 'much', 'must', 'myself',
  'necessary', 'neither', 'oneself', 'ourselves', 'paid', 'perceive',
  'perceiving', 'perhaps', 'quick', 'receive', 'receiving', 'rejoice',
  'rejoicing', 'said', 'should', 'such', 'themselves', 'thyself', 'today',
  'together', 'tomorrow', 'tonight', 'would', 'your', 'yourself',
  'yourselves',
];

// ---------------------------------------------------------------------------
// Assemble curriculum
// ---------------------------------------------------------------------------

const skills = [];
const errors = [];
let order = 0;

function addSkill(id, kind, print, dots, group) {
  if (dots === null) {
    errors.push(`no dot pattern found for ${kind} "${print}" (${id})`);
    return;
  }
  skills.push({ id, kind, print, dots, unicode: dotsToUnicode(dots), group, order });
  order += 1;
}

// 1. Letters a-z
for (const letter of LETTERS) {
  addSkill(`letter-${letter}`, 'letter', letter, findCharRule(chardefLines, ['lowercase'], letter), 'letters');
}

// 2. Capitalisation indicators (their own skills; from en-ueb-g1.ctb).
//    The capital word indicator has no print character of its own; the
//    `print` fields are exemplars ("A" = one capital, "AA" = a run).
addSkill('capital-letter-indicator', 'capital', 'A', findOpcodeDots(g1Lines, 'capsletter'), 'capitals');
addSkill('capital-word-indicator', 'capital', 'AA', findOpcodeDots(g1Lines, 'begcapsword'), 'capitals');

// 3. Number sign (its own early skill), then digits 0-9.
//    Digits use `litdigit` (UEB literary/"upper" numbers: 1 = the "a" cell,
//    preceded in text by the number sign). The `digit` opcode rules in the
//    chardefs table are lower-cell patterns used for other modes — not UEB.
addSkill('number-sign', 'number-sign', '#', findOpcodeDots(g1Lines, 'numsign'), 'numbers');
for (const digit of DIGITS) {
  addSkill(`digit-${digit}`, 'number', digit, findCharRule(chardefLines, ['litdigit'], digit), 'numbers');
}

// 4. Common punctuation
for (const { char, name, dotsOverride } of PUNCTUATION) {
  const dots = dotsOverride ?? findCharRule(chardefLines, ['punctuation'], char);
  addSkill(`punct-${name}`, 'punctuation', char, dots, 'punctuation');
}

// 5. Grade 2 groups, in curriculum order
const G2_GROUPS = [
  ['alphabetic-wordsigns', 'wordsign', 'wordsign', ALPHABETIC_WORDSIGNS],
  ['strong-contractions', 'contraction', 'contraction', STRONG_CONTRACTIONS],
  ['strong-wordsigns', 'wordsign', 'wordsign', STRONG_WORDSIGNS],
  ['strong-groupsigns', 'groupsign', 'groupsign', STRONG_GROUPSIGNS],
  ['lower-signs', 'lowersign', 'lower', LOWER_SIGNS],
  ['initial-letter-contractions', 'initial-letter', 'initial', INITIAL_LETTER_CONTRACTIONS],
  ['final-letter-groupsigns', 'final-letter', 'final', FINAL_LETTER_GROUPSIGNS],
  ['shortforms', 'shortform', 'shortform', SHORTFORMS],
];

for (const [group, kind, idPrefix, words] of G2_GROUPS) {
  for (const word of words) {
    addSkill(`${idPrefix}-${word}`, kind, word, lookupContraction(word), group);
  }
}

// 6. Extended symbols, taught last. Looked up across the chardef
//    punctuation/sign/math opcodes (e.g. `/` and `+` are math, `$` a sign).
for (const { char, name } of SYMBOLS) {
  const dots = findCharRule(chardefLines, ['punctuation', 'sign', 'math'], char);
  addSkill(`punct-${name}`, 'punctuation', char, dots, 'symbols');
}

// ---------------------------------------------------------------------------
// Verify and write
// ---------------------------------------------------------------------------

if (errors.length > 0) {
  console.error('generate-skills: FAILED');
  for (const err of errors) console.error(`  - ${err}`);
  process.exit(1);
}

const EXPECTED = {
  'letter-a': '1',
  'capital-letter-indicator': '6',
  'capital-word-indicator': '6-6',
  'punct-ellipsis': '256-256-256',
  'punct-em-dash': '6-36',
  'punct-dollar': '4-234',
  'punct-slash': '456-34',
  'contraction-and': '12346',
  'groupsign-ing': '346',
  'contraction-the': '2346',
  'number-sign': '3456',
  'lower-be': '23',
  'initial-there': '5-2346',
  'final-ance': '46-15',
  'shortform-about': '1-12',
};
for (const [id, expected] of Object.entries(EXPECTED)) {
  const skill = skills.find((s) => s.id === id);
  const actual = skill?.dots.map((cell) => cell.join('')).join('-');
  if (actual !== expected) {
    console.error(`generate-skills: sanity check failed: ${id} = ${actual}, expected ${expected}`);
    process.exit(1);
  }
}

const ids = new Set(skills.map((s) => s.id));
if (ids.size !== skills.length) {
  console.error('generate-skills: duplicate skill ids');
  process.exit(1);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(skills, null, 2) + '\n');

const perGroup = {};
for (const s of skills) perGroup[s.group] = (perGroup[s.group] ?? 0) + 1;
console.log(`generate-skills: wrote ${skills.length} skills to ${OUT}`);
for (const [group, count] of Object.entries(perGroup)) {
  console.log(`  ${group}: ${count}`);
}
