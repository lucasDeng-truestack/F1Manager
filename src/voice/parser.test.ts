import { describe, expect, it } from 'vitest';
import type { ParsedCommand } from '../sim/types';
import {
  COMMAND_KEYWORDS,
  CONFIDENCE_THRESHOLD,
  FUZZY_SCORE,
  QUALIFIER_KEYWORDS,
  SOLO_ONLY_KEYWORDS,
  normalise,
  parse,
} from './parser';

// Messy real-world transcripts. Add every misheard phrase found while playing.
// [transcript, expected, why]
const TABLE: [string, ParsedCommand, string][] = [
  // --- required cases ---
  ['box box box', 'BOX', 'repeats count once'],
  ['Box, box.', 'BOX', 'punctuation and capitals stripped'],
  ['bocks', 'BOX', 'sound-alike in the table'],
  ['uh push now push', 'PUSH', 'fillers "uh"/"now" dropped'],
  ['save the tyres mate', 'SAVE_TYRES', 'phrase + filler "mate"'],
  ['Save the tires.', 'SAVE_TYRES', 'US spelling'],
  ['defend defend', 'DEFEND', 'repeats'],
  ['plan b', 'PLAN_B', 'phrase'],
  ['Plan bee', 'PLAN_B', 'Whisper spells the letter'],
  ['copy that', 'COPY', 'phrase'],
  ['Roger.', 'COPY', 'single word'],
  ['pit in this lap', 'BOX', '"pit in" phrase; rest is BOX-only too'],
  ['[BLANK_AUDIO]', 'UNKNOWN', 'Whisper silence marker'],
  ['', 'UNKNOWN', 'empty'],
  ['   ', 'UNKNOWN', 'whitespace'],
  ['the weather is nice today', 'UNKNOWN', 'nonsense'],
  ['bob', 'UNKNOWN', '3-letter word one edit from "box" — exact-only guard'],
  // Tie rule: repeats collapse, so PUSH ×1 vs BOX ×1 → tie → said last wins → BOX.
  ['push push no wait box', 'BOX', 'tie → last said wins'],
  [' Box box!  (music)', 'BOX', 'marker stripped'],

  // --- extra messy Whisper outputs ---
  ["Bach's box", 'BOX', 'apostrophe joined ("bachs") and ignored; "box" hits'],
  ['Boxed.', 'BOX', 'past tense Whisper likes; listed explicitly'],
  ['Boxing this lap', 'BOX', 'gerund'],
  ['Pushed!', 'PUSH', 'past tense; listed explicitly'],
  ['Pushin!', 'PUSH', 'fuzzy: one edit from "pushing"'],
  ['Defend.', 'DEFEND', 'trailing full stop'],
  ['The fend!', 'DEFEND', 'Whisper splits "defend"'],
  ['Hold him off, hold him off.', 'DEFEND', 'phrase repeated'],
  ['Keep him behind', 'DEFEND', 'phrase'],
  ['okay copy', 'COPY', 'both COPY; one call'],
  ['Okay.', 'COPY', '"okay" alone is COPY, not filler'],
  ['OK', 'COPY', 'short form'],
  ['Okay, so push.', 'PUSH', '"okay so" is filler; PUSH uncontested'],
  ['Box box, okay?', 'BOX', 'COPY yields to an actionable command even when said last'],
  ['Rodger that', 'COPY', 'fuzzy phrase: rodger ≈ roger'],
  ['Understood, mate.', 'COPY', 'filler dropped'],
  ['Go, go, go!', 'PUSH', 'phrase survives — repeats are not collapsed at token level'],
  ['Full-send!', 'PUSH', 'hyphen splits words'],
  ['Lift and coast please', 'SAVE_TYRES', 'phrase with trailing noise'],
  ['save the the tyres', 'SAVE_TYRES', 'stutter inside a phrase'],
  ['save the tyre', 'SAVE_TYRES', 'fuzzy: tyre ≈ tyres'],
  ['Save uh the tyres', 'SAVE_TYRES', 'filler inside a phrase'],
  ['Plan B, please.', 'PLAN_B', 'longest phrase'],
  ['switch plan', 'PLAN_B', 'phrase'],
  ['[inaudible] box', 'BOX', 'marker before a keyword'],
  ['*music*', 'UNKNOWN', 'asterisk marker'],
  ['♪', 'UNKNOWN', 'music note only'],
  ['(upbeat music) [BLANK_AUDIO]', 'UNKNOWN', 'markers only'],
  ['Thank you.', 'UNKNOWN', 'classic Whisper hallucination on silence'],
  ['plan', 'UNKNOWN', 'half a phrase'],
  ['fox', 'UNKNOWN', 'exact-only guard for "box"'],
  ['put it in', 'UNKNOWN', 'exact-only guard for "pit"'],
  ['bit', 'UNKNOWN', 'exact-only guard for "pit"'],
  ['we have a problem', 'UNKNOWN', '"have" must not fuzzy into "save"'],
  ['it looks good', 'UNKNOWN', 'BOX is exact-only: "looks" is not "books"'],
  ['rocks', 'UNKNOWN', 'BOX is exact-only: "rocks" is not "bocks"'],
  ['DEFEND DEFEND DEFEND!!!', 'DEFEND', 'shouting'],
  ['Défend', 'DEFEND', 'accent stripped'],

  // --- negation: a negated keyword does not count, for every command ---
  ["don't box", 'UNKNOWN', 'negator right before the keyword'],
  ['Stay out, no box.', 'UNKNOWN', 'there is no STAY_OUT command; "no box" is negated'],
  ['stay out', 'UNKNOWN', 'no command word at all'],
  ['Stay out, do not pit.', 'UNKNOWN', '"not" right before "pit"'],
  ['do not box', 'UNKNOWN', '"do not"'],
  ['never box', 'UNKNOWN', '"never"'],
  ["Don't you box!", 'UNKNOWN', 'bridge word "you" between negator and keyword'],
  ["don't box this lap", 'UNKNOWN', 'negation covers a whole phrase'],
  ['not in this lap', 'UNKNOWN', 'negated qualifier'],
  ['No, no, box box.', 'UNKNOWN', 'negation carries over straight repeats; "say again?" beats a wrong toggle'],
  ["No, no, don't push.", 'UNKNOWN', 'negation suppresses PUSH, not just BOX'],
  ["can't push", 'UNKNOWN', '"cant" (apostrophe stripped) is a negator'],
  ['never ever push', 'UNKNOWN', 'bridge word "ever"'],
  ["don't defend", 'UNKNOWN', 'negated DEFEND'],
  ["don't save the tyres", 'UNKNOWN', 'negated SAVE_TYRES phrase'],
  ['no plan b', 'UNKNOWN', 'negated PLAN_B'],
  ['not understood', 'UNKNOWN', 'negated COPY'],
  ["Don't uh box", 'UNKNOWN', 'filler between negator and keyword is dropped first'],
  ["Push, don't box.", 'PUSH', 'only the negated command is dropped'],
  ["Don't push, save the tyres.", 'SAVE_TYRES', 'negated PUSH, then a real call'],
  ['No worries, push.', 'PUSH', 'a non-bridge word between "no" and the keyword ends the scope'],
  ['Never mind, push.', 'PUSH', 'same: "mind" is not a bridge'],
  ['No problem, box this lap.', 'BOX', 'same, for BOX'],

  // --- BOX is exact-only: everyday words one edit from a BOX entry never fire ---
  ['the backs are gone', 'UNKNOWN', '"backs" inside an ordinary sentence (solo-only entry)'],
  ['nice boots', 'UNKNOWN', '"boots" is one edit from "books"; BOX never fuzzes'],
  ['boots', 'UNKNOWN', 'even alone'],
  ['I am bored', 'UNKNOWN', '"bored" is one edit from "boxed"'],
  ['bored', 'UNKNOWN', 'even alone'],
  ['boring', 'UNKNOWN', '"boring" is one edit from "boxing"'],
  ['This is boring.', 'UNKNOWN', 'in a sentence'],
  ['he blocks', 'UNKNOWN', '"blocks" is one edit from "bocks"'],
  ['boxer', 'UNKNOWN', 'one edit from "boxed"'],
  ['nice books', 'UNKNOWN', '"books" is solo-only'],

  // --- BOX sound-alikes Whisper really produces: fine when they are the whole call ---
  ['bucks', 'BOX', 'solo-only sound-alike, alone'],
  ['Backs.', 'BOX', 'solo-only sound-alike, alone'],
  ['Bucks, bucks!', 'BOX', 'repeated, still only command words'],
  ['Boxes.', 'BOX', 'solo-only sound-alike, alone'],
  ['box, boxes', 'BOX', 'every word is a command word'],
  ['uh backs', 'BOX', 'fillers are dropped before the solo check'],
  ['Books.', 'BOX', 'solo-only sound-alike, alone'],
  ["Boxin'!", 'BOX', 'listed explicitly now that BOX never fuzzes'],

  // --- a qualifier never outvotes a command word ---
  ['push in this lap', 'PUSH', '"in this lap" says when, not what'],
  ['in this lap', 'BOX', 'qualifier alone still means BOX'],
  ['In this lap, okay?', 'BOX', 'a qualifier still beats COPY'],
  ['box, in this lap', 'BOX', 'qualifier agrees with the command'],

  // --- regressions: positive BOX calls still work ---
  ['box box', 'BOX', 'regression'],
  ['Box this lap.', 'BOX', 'regression: phrase'],
  ['boxes', 'BOX', 'regression: used to be a fuzzy hit on "boxed"'],
  ['Okay, box box.', 'BOX', 'regression: COPY yields'],
  ['okay box box', 'BOX', 'regression'],
  ['pit pit', 'BOX', 'regression'],
  ['Boxing.', 'BOX', 'regression'],
  ['push push no wait box', 'BOX', 'regression: "no wait" is a correction, not a negation'],
];

describe('parse — messy transcript table', () => {
  it.each(TABLE)('%j → %s (%s)', (transcript, expected) => {
    expect(parse(transcript).command).toBe(expected);
  });

  it.each(TABLE)('%j has confidence in 0..1 and matched entries from the table', (transcript, expected) => {
    const r = parse(transcript);
    expect(r.confidence).toBeGreaterThanOrEqual(0);
    expect(r.confidence).toBeLessThanOrEqual(1);
    if (expected !== 'UNKNOWN') {
      expect(r.matched.length).toBeGreaterThan(0);
      expect(r.confidence).toBeGreaterThanOrEqual(CONFIDENCE_THRESHOLD);
      for (const m of r.matched) expect(COMMAND_KEYWORDS[expected]).toContain(m);
    }
  });
});

describe('parse — UNKNOWN shapes', () => {
  it.each(['', '   ', '[BLANK_AUDIO]', '(music)', 'the weather is nice today', 'bob'])(
    '%j → UNKNOWN, confidence 0, matched []',
    (transcript) => {
      expect(parse(transcript)).toEqual({ command: 'UNKNOWN', confidence: 0, matched: [] });
    },
  );

  it('a contested fuzzy hit falls below threshold → UNKNOWN with the best candidate', () => {
    // PUSH ×1 exact, DEFEND ×1 fuzzy ("defends" ≈ "defend"); tie → DEFEND (last),
    // confidence 0.7 × 0.75 = 0.525 < 0.6.
    const r = parse('push defends');
    expect(r.command).toBe('UNKNOWN');
    expect(r.confidence).toBeCloseTo(FUZZY_SCORE * 0.75, 10);
    expect(r.confidence).toBeLessThan(CONFIDENCE_THRESHOLD);
    expect(r.matched).toEqual(['defend']);
  });
});

describe('parse — negation, solo-only and qualifier rules', () => {
  it('negated hits are dropped entirely: UNKNOWN, confidence 0, matched []', () => {
    expect(parse("don't box")).toEqual({ command: 'UNKNOWN', confidence: 0, matched: [] });
    expect(parse("no no don't push")).toEqual({ command: 'UNKNOWN', confidence: 0, matched: [] });
    expect(parse('the backs are gone')).toEqual({ command: 'UNKNOWN', confidence: 0, matched: [] });
  });

  it('a dropped hit is not contention for the real call', () => {
    expect(parse("push, don't box")).toEqual({ command: 'PUSH', confidence: 1, matched: ['push'] });
    expect(parse('push in this lap')).toEqual({ command: 'PUSH', confidence: 1, matched: ['push'] });
  });

  it('a negated hit does not split a run of repeats', () => {
    // PUSH ×1 (the negated BOX between is dropped), DEFEND ×1 → tie → DEFEND (last).
    expect(parse("push, don't box, push, defend").command).toBe('DEFEND');
  });

  it('negation scope: the next hit, across a bridge word, and straight repeats of it only', () => {
    expect(parse('no box box').command).toBe('UNKNOWN');
    expect(parse('no box push').command).toBe('PUSH'); // a different command ends the scope
    expect(parse('no box, wait, box').command).toBe('BOX'); // a word in between ends the scope
    expect(parse('no wait box').command).toBe('BOX');
  });
});

describe('parse — conflict rule', () => {
  it('most calls wins', () => {
    expect(parse('push box push').command).toBe('PUSH');
  });

  it('tie → the command said last wins', () => {
    expect(parse('box push').command).toBe('PUSH');
    expect(parse('push box').command).toBe('BOX');
  });

  it('repeats in a row count once (also across fillers and noise words)', () => {
    expect(parse('push push push box').command).toBe('BOX');
    expect(parse('push uh no push box').command).toBe('BOX');
  });

  it('COPY yields to any actionable command', () => {
    expect(parse('box okay').command).toBe('BOX');
    expect(parse('copy copy roger push').command).toBe('PUSH');
    expect(parse('copy push copy').confidence).toBe(1); // COPY does not count as contention
  });

  it('a yielded COPY does not split a run of repeats', () => {
    // PUSH ×1 (the COPY between is ignored), BOX ×1 → tie → BOX, same as "push push box".
    expect(parse('push copy push box').command).toBe('BOX');
    expect(parse('push push box').command).toBe('BOX');
  });

  it('a phrase beats its sub-words', () => {
    expect(parse('save the tyres')).toEqual({ command: 'SAVE_TYRES', confidence: 1, matched: ['save the tyres'] });
    expect(parse('plan b')).toEqual({ command: 'PLAN_B', confidence: 1, matched: ['plan b'] });
    expect(parse('pit in this lap').matched).toEqual(['pit in']);
  });

  it('confidence: uncontested exact = 1, fuzzy = FUZZY_SCORE, exact 2-way tie = 0.75', () => {
    expect(parse('box').confidence).toBe(1);
    expect(parse('pushin').confidence).toBe(FUZZY_SCORE);
    expect(parse('push no wait box').confidence).toBe(0.75);
  });

  it('matched lists each table entry once, in the order heard', () => {
    expect(parse('box bocks box pit').matched).toEqual(['box', 'bocks', 'pit']);
    expect(parse('rodger').matched).toEqual(['roger']); // fuzzy reports the table entry, not the heard word
  });
});

describe('parse — purity and determinism', () => {
  it('same transcript → identical result, fresh objects each call', () => {
    const a = parse('push push no wait box');
    const b = parse('push push no wait box');
    expect(a).toEqual(b);
    expect(a.matched).not.toBe(b.matched);
  });

  it('mutating a result does not leak into later calls', () => {
    const a = parse('box');
    a.matched.push('junk');
    expect(parse('box').matched).toEqual(['box']);
  });

  it('the keyword table is frozen', () => {
    expect(Object.isFrozen(COMMAND_KEYWORDS)).toBe(true);
    for (const list of Object.values(COMMAND_KEYWORDS)) expect(Object.isFrozen(list)).toBe(true);
  });
});

describe('COMMAND_KEYWORDS hygiene', () => {
  const entries = Object.entries(COMMAND_KEYWORDS).flatMap(([cmd, list]) => list.map((k) => [cmd, k] as const));

  it('every command has keywords', () => {
    for (const list of Object.values(COMMAND_KEYWORDS)) expect(list.length).toBeGreaterThan(0);
  });

  it.each(entries)('%s: %j is already normalised and contains no filler', (_cmd, keyword) => {
    expect(normalise(keyword).join(' ')).toBe(keyword);
  });

  it.each(entries)('%s: %j parses to its own command', (cmd, keyword) => {
    expect(parse(keyword).command).toBe(cmd);
  });

  it.each([...SOLO_ONLY_KEYWORDS, ...QUALIFIER_KEYWORDS])('%j is a COMMAND_KEYWORDS entry', (keyword) => {
    expect(entries.map(([, k]) => k)).toContain(keyword);
  });

  it('no keyword is listed under two commands', () => {
    const seen = new Map<string, string>();
    for (const [cmd, k] of entries) {
      expect(seen.get(k) ?? cmd).toBe(cmd);
      seen.set(k, cmd);
    }
  });
});

describe('normalise', () => {
  it.each([
    [' Box box!  (music)', ['box', 'box']],
    ['okay so push', ['push']],
    ['ok so, um, box now mate', ['box']],
    ['okay', ['okay']],
    ["Bach's box", ['bachs', 'box']],
    ['go-go-go', ['go', 'go', 'go']],
    ['[BLANK_AUDIO]', []],
    ['', []],
  ])('%j → %j', (input, tokens) => {
    expect(normalise(input)).toEqual(tokens);
  });
});
