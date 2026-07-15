// The built-in corpus of real English words used for prompt generation.
// Prompts are monkeytype-style sequences of real words — never nonsense
// letter clusters — so every letter/contraction skill needs at least one
// word here that is usable at the moment the skill becomes active (all
// earlier skills learnt, the 5-skill window active). corpus.test.ts and
// prompts.test.ts enforce that reachability property.
//
// Everything is lowercase letters only; capitalisation is applied by the
// prompt generator ("I" is added dynamically once the capital indicator is
// known). All entries must translate cleanly with src/core/braille.ts.

/** Real English words (lowercase, letters only). */
export const WORDS: ReadonlyArray<string> = [
  // usable from the very first active window {a,b,c,d,e}
  'a', 'ace', 'add', 'baa', 'babe', 'bad', 'bee', 'cab', 'cad', 'dab', 'dad',
  'ebb',
  // letters f..z as they activate (window = everything earlier + 4 ahead);
  // chosen to avoid not-yet-known contractions (ed, er, in, st, ...)
  'fad', 'fib', 'fig', 'face', 'if',
  'bag', 'beg', 'big', 'dig', 'egg', 'gag', 'gig', 'jig', 'keg', 'cage',
  'hag', 'hid', 'hide', 'hail', 'hall',
  'aid', 'bid', 'dim', 'jib', 'kid', 'lid', 'mid',
  'jab', 'jam',
  'back', 'bake', 'cake', 'kick', 'lack', 'lake', 'lick', 'oak',
  'ball', 'call', 'doll', 'fall', 'gal', 'lab', 'lad', 'lag', 'lap', 'pal',
  'dam', 'gem', 'ham', 'mad', 'map', 'mob', 'mom',
  'ban', 'fan', 'nab', 'nag', 'nap', 'nip', 'nod', 'on', 'pan',
  'dog', 'fog', 'hop', 'log', 'mop', 'no', 'odd', 'pod', 'rob', 'son',
  'pad', 'pat', 'pit', 'pop', 'pot', 'tap', 'top',
  'aqua', 'quad', 'quip', 'quit',
  'bar', 'car', 'rag', 'ram', 'rap', 'rat', 'rub',
  'bus', 'gas', 'sad', 'sap', 'sat', 'sip', 'sob',
  'bat', 'cat', 'hat', 'mat', 'tab', 'tag',
  'bud', 'bun', 'cub', 'cup', 'dug', 'gum', 'hug', 'jug', 'mug', 'nut',
  'sum', 'tub',
  'van', 'vat', 'vet', 'vim',
  'jaw', 'paw', 'wag', 'wax', 'web', 'wig',
  'box', 'fax', 'fix', 'fox', 'mix', 'ox', 'six', 'tax',
  'boy', 'gym', 'joy', 'toy', 'yak', 'yam', 'yap', 'yes',
  'buzz', 'fuzz', 'jazz', 'zag', 'zap', 'zip', 'zoo',
  // more plain words for variety
  'sun', 'run', 'fun', 'pig', 'pup', 'gap', 'wet', 'pet', 'net', 'jet',
  'leg', 'ten', 'men', 'pen', 'tent', 'went', 'end', 'pin', 'win', 'tin',
  'skin', 'mud', 'owl', 'up', 'quiz',
  // alphabetic wordsigns (standalone)
  'but', 'can', 'do', 'every', 'from', 'go', 'have', 'it', 'just',
  'knowledge', 'like', 'more', 'not', 'people', 'quite', 'rather', 'so',
  'that', 'us', 'very', 'will', 'you', 'as',
  // strong contractions, standalone and inside words
  'and', 'for', 'of', 'the', 'with', 'sand', 'band', 'hand', 'land',
  'stand', 'soft', 'fort', 'then', 'them', 'other', 'weather',
  // strong wordsigns
  'child', 'shall', 'this', 'which', 'out', 'still',
  // strong groupsigns
  'chat', 'chip', 'much', 'rich', 'lunch', 'laugh', 'ship', 'shop', 'fish',
  'wish', 'dish', 'cash', 'math', 'bath', 'both', 'moth', 'whip', 'whim',
  'why', 'whale', 'bed', 'fed', 'red', 'sled', 'her', 'herd', 'term',
  'fern', 'loud', 'soup', 'cloud', 'cow', 'how', 'low', 'town', 'stop',
  'fast', 'last', 'list', 'mist', 'nest', 'far', 'hard', 'park',
  'arm', 'art', 'king', 'sing', 'ring', 'wing', 'thing', 'spring',
  // lower signs
  'read', 'meat', 'seat', 'bead', 'rabbit', 'hobby', 'occur', 'office',
  'buffalo', 'buggy', 'foggy', 'soggy', 'begun', 'betray', 'contact',
  'convey', 'dismay', 'display', 'be', 'enough', 'his', 'in', 'was', 'were',
  // initial-letter contractions (all standalone words), plus inside words
  'day', 'ever', 'father', 'here', 'know', 'lord', 'mother', 'name', 'one',
  'part', 'question', 'right', 'some', 'time', 'under', 'work', 'young',
  'character', 'through', 'where', 'ought', 'there', 'these', 'those',
  'upon', 'whose', 'word', 'cannot', 'had', 'many', 'spirit', 'their',
  'world',
  'monday', 'sunday', 'money', 'honey', 'stone', 'alone', 'partly',
  // final-letter groupsigns
  'found', 'round', 'sound', 'dance', 'chance', 'mission', 'useless',
  'unless', 'count', 'mount', 'fence', 'silence', 'song', 'long', 'strong',
  'useful', 'careful', 'nation', 'station', 'darkness', 'kindness',
  'moment', 'payment', 'city', 'unity',
  // shortforms (standalone)
  'about', 'above', 'across', 'after', 'again', 'against', 'almost',
  'already', 'also', 'always', 'because', 'before', 'behind', 'below',
  'between', 'blind', 'braille', 'children', 'could', 'declare', 'either',
  'first', 'friend', 'good', 'great', 'herself', 'him', 'himself',
  'immediate', 'its', 'itself', 'letter', 'little', 'must', 'myself',
  'necessary', 'neither', 'paid', 'perhaps', 'quick', 'receive', 'rejoice',
  'said', 'should', 'such', 'themselves', 'today', 'together', 'tomorrow',
  'tonight', 'would', 'your', 'yourself', 'yourselves',
];
