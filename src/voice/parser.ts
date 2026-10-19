import type { Command, ParsedCommand } from '../sim/types';

/**
 * Every keyword, phrase and sound-alike the parser accepts, one array per command.
 * This is the ONLY place command words live — tune here (the README documents it).
 *
 * Rules for entries:
 * - Write them already normalised: lowercase, `a-z0-9` and single spaces, no fillers
 *   (a test enforces this, and that no entry appears under two commands).
 * - Multi-word entries are phrases. At each position the longest phrase wins, so
 *   "save the tyres" is one SAVE_TYRES hit and never also a bare "save".
 * - Entries of FUZZY_MIN_LENGTH+ letters also match one typo away (see `tokenScore`);
 *   shorter ones are exact only, so list their sound-alikes explicitly. BOX never matches
 *   one typo away, whatever the length (see EXACT_ONLY_COMMANDS).
 * - Sound-alikes that are everyday English words go in SOLO_ONLY_KEYWORDS too; qualifiers
 *   that say when rather than what go in QUALIFIER_KEYWORDS too.
 */
export const COMMAND_KEYWORDS: Record<Command, readonly string[]> = Object.freeze({
  // Pit this lap (or cancel a queued stop). Every BOX entry is exact-only (EXACT_ONLY_COMMANDS):
  // bob, fox, put, bit, boots, bored, boring, blocks must not hit, so sound-alikes are listed.
  BOX: Object.freeze([
    'box', 'bocks', 'boks', 'boxx', 'books', 'boxed', 'boxing', 'boxin',
    'backs', 'bucks', 'boxes',
    'pit', 'pits', 'pit in', 'box this lap', 'in this lap',
  ]),
  // Push mode.
  PUSH: Object.freeze(['push', 'pushing', 'pushed', 'posh', 'flat out', 'full send', 'go go go']),
  // Tyre-saving mode. Bare "save" is exact-only ("have", "safe", "same" must not hit).
  SAVE_TYRES: Object.freeze([
    'save tyres', 'save the tyres', 'save tires', 'save the tires', 'tyre save',
    'manage the tyres', 'look after the tyres', 'lift and coast', 'save',
  ]),
  // Defend position. "the fend" is how Whisper often splits "defend".
  DEFEND: Object.freeze([
    'defend', 'defending', 'defence', 'defense', 'the fend',
    'hold him off', 'keep him behind', 'cover the inside',
  ]),
  // Swap the planned pit compound.
  PLAN_B: Object.freeze(['plan b', 'plan bee', 'plan be', 'plan b please', 'switch plan', 'other plan']),
  // Acknowledgement only. Yields to any actionable command in the same transcript (see `parse`).
  COPY: Object.freeze([
    'copy', 'copy that', 'copied', 'roger', 'roger that', 'understood', 'got it',
    'okay', 'ok', 'affirm', 'affirmative',
  ]),
});

/**
 * Commands whose entries match exactly only, never one edit away. BOX toggles a ~22 s pit
 * stop (or cancels a queued one), so a false BOX is the costliest mistake the parser can
 * make, and the BOX sound-alikes sit one edit from everyday words: books/boots,
 * boxed/bored, boxing/boring, bocks/blocks. Whisper's real mishearings are listed instead.
 */
const EXACT_ONLY_COMMANDS: ReadonlySet<Command> = new Set<Command>(['BOX']);

/**
 * Table entries that are also everyday English words. Whisper does hear a lone "box" as
 * "books", "backs", "bucks" or "boxes", but those words turn up in ordinary sentences too,
 * so they count only when the whole transcript is command words (after fillers are dropped):
 * "backs", "Bucks!", "boxes boxes", "box, boxes" → BOX; "the backs are gone" → UNKNOWN.
 * Every entry here must be in COMMAND_KEYWORDS (a test enforces it).
 */
export const SOLO_ONLY_KEYWORDS: ReadonlySet<string> = new Set(['books', 'backs', 'bucks', 'boxes']);

/**
 * Table entries that say when, not what. They count only when no command word was said:
 * "in this lap" → BOX, but "push in this lap" → PUSH. Every entry here must be in
 * COMMAND_KEYWORDS (a test enforces it).
 */
export const QUALIFIER_KEYWORDS: ReadonlySet<string> = new Set(['in this lap']);

/**
 * Negation. A keyword hit (any command) right after a negator does not count: "don't box",
 * "stay out, no box", "do not pit", "don't push" say nothing actionable. "Right after" means
 * the next token, or the one after that when the word between is a NEGATION_BRIDGES word
 * ("don't you box", "never ever push"). The negation also covers repeats of that same
 * command said straight after it ("no box box"). Any other word in between ends the scope,
 * so "push, no wait, box" is still BOX and "no worries, push" is still PUSH. A bare
 * correction "no, box!" reads as "no box" → UNKNOWN; the driver asks "say again?", which is
 * cheaper than a wrong pit-stop toggle.
 */
const NEGATORS: ReadonlySet<string> = new Set(['no', 'not', 'dont', 'never', 'wont', 'cant', 'shouldnt']);
const NEGATION_BRIDGES: ReadonlySet<string> = new Set(['you', 'ever', 'even', 'to']);

/**
 * Final confidence below this → UNKNOWN (the driver replies "Say again?").
 * With the numbers below: any exact hit passes, a lone fuzzy hit passes (0.7), an exact
 * hit in a 2-way tie passes (0.75), a fuzzy hit that is contested fails (≤ 0.583).
 */
export const CONFIDENCE_THRESHOLD = 0.6;

/** Keywords shorter than this match exactly only; at this length or longer, Levenshtein ≤ 1. */
export const FUZZY_MIN_LENGTH = 5;

/** Score of a one-edit-away token (an exact token scores 1). A phrase scores its weakest token. */
export const FUZZY_SCORE = 0.7;

/**
 * How much contention costs: confidence = bestHitScore × (1 − CONTENTION_PENALTY × (1 − share)),
 * where share = winner's count / all competing counts. Uncontested → share 1 → no penalty.
 */
export const CONTENTION_PENALTY = 0.5;

/**
 * Radio filler dropped before matching. Single words, then multi-word fillers.
 * "okay"/"ok" alone is a COPY keyword, so only the discourse marker "okay so" / "ok so" is
 * filler ("okay so push" → PUSH, "okay" → COPY). The project map also lists "the driver's
 * name" — the player's car code is YOU, so there is no name to drop.
 */
const FILLER_WORDS: ReadonlySet<string> = new Set(['uh', 'uhh', 'um', 'umm', 'uhm', 'er', 'erm', 'hmm', 'like', 'now', 'mate']);
const FILLER_PHRASES: readonly (readonly string[])[] = [['okay', 'so'], ['ok', 'so']];

/** The acknowledgement command: it never beats an actionable command. */
const ACK_COMMAND: Command = 'COPY';

/** Whisper non-speech markers: [BLANK_AUDIO], [inaudible], (music), (upbeat music), *laughs*, ♪. */
const MARKER_RE = /\[[^\]]*\]|\([^)]*\)|\*[^*]*\*|♪/g;

export interface ParseResult {
  command: ParsedCommand;
  confidence: number;  // 0..1
  matched: string[];   // COMMAND_KEYWORDS entries that hit for the reported (or best) candidate
}

/** Lowercase, strip markers, accents, apostrophes and punctuation; split into tokens. No filler drop. */
function tokenize(text: string): string[] {
  const clean = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(MARKER_RE, ' ')
    .replace(/['‘’`]/g, '') // "bach's" → "bachs", "don't" → "dont"
    .replace(/[^a-z0-9]+/g, ' ')      // hyphens and all other punctuation split words
    .trim();
  return clean === '' ? [] : clean.split(' ');
}

function startsWithAt(tokens: readonly string[], i: number, phrase: readonly string[]): boolean {
  return phrase.every((word, k) => tokens[i + k] === word);
}

/**
 * Normalised tokens of a transcript: `tokenize` then drop fillers. Repeats are NOT collapsed
 * here ("go go go" is a phrase); repetition is collapsed at the hit level in `parse`.
 */
export function normalise(transcript: string): string[] {
  const tokens = tokenize(transcript);
  const out: string[] = [];
  let i = 0;
  while (i < tokens.length) {
    const phrase = FILLER_PHRASES.find((p) => startsWithAt(tokens, i, p));
    if (phrase) { i += phrase.length; continue; }
    const token = tokens[i] as string;
    if (!FILLER_WORDS.has(token)) out.push(token);
    i++;
  }
  return out;
}

/** True when a and b are exactly one insertion, deletion or substitution apart. */
function oneEditApart(a: string, b: string): boolean {
  if (a === b || Math.abs(a.length - b.length) > 1) return false;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  let i = 0;
  while (i < s.length && s[i] === l[i]) i++;
  // Skip the one differing char: substitution if same length, else the insertion in the longer.
  return s.length === l.length ? s.slice(i + 1) === l.slice(i + 1) : s.slice(i) === l.slice(i + 1);
}

/**
 * Score one heard token against one keyword token. Fuzzy guard: the keyword's command must
 * allow fuzzy (EXACT_ONLY_COMMANDS), the keyword must be FUZZY_MIN_LENGTH+ letters AND the
 * first letter must match, so "rocks" never drifts into a keyword and 3–4 letter words
 * (push, save, copy) never drift.
 */
function tokenScore(heard: string, want: string, fuzzy: boolean): number {
  if (heard === want) return 1;
  if (fuzzy && want.length >= FUZZY_MIN_LENGTH && heard[0] === want[0] && oneEditApart(heard, want)) return FUZZY_SCORE;
  return 0;
}

interface CompiledKeyword { command: Command; keyword: string; tokens: readonly string[]; fuzzy: boolean }

const COMMANDS = Object.keys(COMMAND_KEYWORDS) as Command[];

const COMPILED: readonly CompiledKeyword[] = COMMANDS.flatMap((command) =>
  COMMAND_KEYWORDS[command].map((keyword) => ({
    command,
    keyword,
    tokens: tokenize(keyword),
    fuzzy: !EXACT_ONLY_COMMANDS.has(command),
  })),
);

/**
 * Match one keyword starting at tokens[i]. Returns tokens consumed and the phrase score
 * (its weakest token), or null. Stutter tolerance: inside a phrase, a heard token that
 * repeats the previous one is skipped ("save the the tyres").
 */
function matchAt(tokens: readonly string[], i: number, kw: CompiledKeyword): { consumed: number; score: number } | null {
  let j = i;
  let score = 1;
  for (let k = 0; k < kw.tokens.length; k++) {
    const want = kw.tokens[k] as string;
    if (k > 0) while (j < tokens.length && tokens[j] === tokens[j - 1] && tokens[j] !== want) j++;
    const heard = tokens[j];
    if (heard === undefined) return null;
    const s = tokenScore(heard, want, kw.fuzzy);
    if (s === 0) return null;
    score = Math.min(score, s);
    j++;
  }
  return { consumed: j - i, score };
}

/** One keyword heard. `start`/`end` index the normalised tokens; `negated` per NEGATORS. */
interface Hit { command: Command; keyword: string; score: number; start: number; end: number; negated: boolean }

/** True when tokens[i] is negated: a negator just before it, or two before across a bridge word. */
function negatedAt(tokens: readonly string[], i: number): boolean {
  const prev = tokens[i - 1];
  if (prev === undefined) return false;
  if (NEGATORS.has(prev)) return true;
  const prev2 = tokens[i - 2];
  return NEGATION_BRIDGES.has(prev) && prev2 !== undefined && NEGATORS.has(prev2);
}

/**
 * Left-to-right scan; at each position the longest keyword wins, then the higher score, then
 * table order. Each hit is marked negated (see NEGATORS); a negated hit's scope carries on to a
 * hit of the same command that starts exactly where it ended ("no box box").
 */
function findHits(tokens: readonly string[]): Hit[] {
  const hits: Hit[] = [];
  let i = 0;
  while (i < tokens.length) {
    let best: { kw: CompiledKeyword; consumed: number; score: number } | null = null;
    for (const kw of COMPILED) {
      const m = matchAt(tokens, i, kw);
      if (!m) continue;
      if (
        !best ||
        kw.tokens.length > best.kw.tokens.length ||
        (kw.tokens.length === best.kw.tokens.length && m.score > best.score)
      ) best = { kw, ...m };
    }
    if (best) {
      const prev = hits[hits.length - 1];
      const carried = prev !== undefined && prev.negated && prev.end === i && prev.command === best.kw.command;
      const end = i + best.consumed;
      hits.push({
        command: best.kw.command,
        keyword: best.kw.keyword,
        score: best.score,
        start: i,
        end,
        negated: carried || negatedAt(tokens, i),
      });
      i = end;
    } else {
      i++;
    }
  }
  return hits;
}

/**
 * Priority tier of a hit: a command word (2) beats a qualifier (1) beats an acknowledgement (0).
 * Only hits of the highest tier present are tallied.
 */
function tier(hit: Hit): number {
  if (hit.command === ACK_COMMAND) return 0;
  return QUALIFIER_KEYWORDS.has(hit.keyword) ? 1 : 2;
}

interface Tally { command: Command; count: number; lastHit: number; bestScore: number; matched: string[] }

/**
 * Parse a Whisper transcript into a command.
 *
 * Conflict rule (documented for the README):
 * 0. Hits that do not count are dropped first, as if never said:
 *    - negated hits ("don't box", "stay out, no box", "no no don't push"; see NEGATORS);
 *    - SOLO_ONLY_KEYWORDS hits when the transcript has any non-command word
 *      ("the backs are gone" drops "backs"; "backs" alone is BOX).
 * 1. Repeats in a row count once: consecutive hits of the same command (ignoring
 *    non-keyword words between them) are one "call". "box box box" = BOX ×1,
 *    "push push no wait box" = PUSH ×1, BOX ×1.
 * 2. Tiers: command words beat qualifiers, which beat COPY. If any command word hit,
 *    qualifier and COPY hits are ignored ("push in this lap" → PUSH, "box box, okay?" → BOX);
 *    a qualifier wins only with no command word ("in this lap" → BOX, "in this lap, okay" →
 *    BOX); COPY wins only when it is the only thing said.
 * 3. The command with the most calls wins ("push box push" → PUSH).
 * 4. On a tie, the command said last wins ("push push no wait box" → BOX).
 * 5. confidence = winner's best hit score × contention factor (see CONTENTION_PENALTY);
 *    below CONFIDENCE_THRESHOLD → UNKNOWN, still reporting that confidence and the matches.
 * Nothing left after rule 0 (empty, markers only, nonsense, only negated or dropped hits)
 * → UNKNOWN, confidence 0, matched [].
 */
export function parse(transcript: string): ParseResult {
  const tokens = normalise(transcript);
  const found = findHits(tokens);

  // Rule 0. Hits never overlap, so summing their spans counts the command-word tokens.
  const commandWordsOnly = found.reduce((n, h) => n + h.end - h.start, 0) === tokens.length;
  const allHits = found.filter((h) => !h.negated && (commandWordsOnly || !SOLO_ONLY_KEYWORDS.has(h.keyword)));
  if (allHits.length === 0) return { command: 'UNKNOWN', confidence: 0, matched: [] };

  // Rule 2 before rule 1, so a yielded hit can't split a run ("push copy push" is still PUSH ×1).
  const topTier = Math.max(...allHits.map(tier));
  const hits = allHits.filter((h) => tier(h) === topTier);

  const tallies = new Map<Command, Tally>();
  hits.forEach((hit, index) => {
    const prev = hits[index - 1];
    let t = tallies.get(hit.command);
    if (!t) {
      t = { command: hit.command, count: 0, lastHit: -1, bestScore: 0, matched: [] };
      tallies.set(hit.command, t);
    }
    if (!prev || prev.command !== hit.command) t.count++;
    t.lastHit = index;
    t.bestScore = Math.max(t.bestScore, hit.score);
    if (!t.matched.includes(hit.keyword)) t.matched.push(hit.keyword);
  });

  const pool = [...tallies.values()];
  let winner = pool[0] as Tally;
  for (const t of pool) {
    if (t.count > winner.count || (t.count === winner.count && t.lastHit > winner.lastHit)) winner = t;
  }

  const total = pool.reduce((sum, t) => sum + t.count, 0);
  const share = winner.count / total;
  const confidence = Math.min(1, Math.max(0, winner.bestScore * (1 - CONTENTION_PENALTY * (1 - share))));
  const matched = [...winner.matched];

  if (confidence < CONFIDENCE_THRESHOLD) return { command: 'UNKNOWN', confidence, matched };
  return { command: winner.command, confidence, matched };
}
