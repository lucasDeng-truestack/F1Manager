import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SEED, PLAYER_ID, createRace, evaluateCalls, simulateRace } from '../sim';
import type { CommandInput, ParsedCommand, RaceState } from '../sim/types';
import { DEBRIEF_HOLD_MS, computeImpacts, scheduleDebrief } from './loop';
import { ENGINEER_PHRASES, INITIAL_VOICE, initialGameState, useGameStore } from './store';
import type { CommandSource } from './types';

const store = () => useGameStore.getState();
const race = (): RaceState => {
  const r = store().race;
  if (r === null) throw new Error('no race');
  return r;
};

/** advance() until race.tick === tick (or the race ends). */
function advanceTo(tick: number): void {
  while (race().phase === 'racing' && race().tick < tick) store().advance();
}

function finish(): RaceState {
  let guard = 0;
  while (race().phase === 'racing') {
    store().advance();
    if (++guard > 20_000) throw new Error('race never finished');
  }
  return race();
}

type Plan = { tick: number; cmd: ParsedCommand; source?: CommandSource; transcript?: string };

/** Plays a whole race through the store, issuing each call when race.tick reaches its tick. */
function play(plan: readonly Plan[]): RaceState {
  store().startRace();
  for (const p of plan) {
    advanceTo(p.tick);
    store().issueCommand(p.cmd, p.source ?? 'keyboard', p.transcript);
  }
  return finish();
}

beforeEach(() => {
  useGameStore.setState(initialGameState());
});

afterEach(() => {
  vi.useRealTimers();
});

describe('initial state', () => {
  it('starts on the start screen with the default seed and idle voice', () => {
    const s = store();
    expect(s.screen).toBe('start');
    expect(s.seed).toBe(DEFAULT_SEED);
    expect(s.race).toBeNull();
    expect(s.voice).toEqual(INITIAL_VOICE);
  });
});

describe('startRace', () => {
  it('creates the race from the trimmed seed and resets the logs', () => {
    useGameStore.setState({ calls: [{ tick: 1, lap: 1, command: 'BOX', source: 'keyboard', transcript: null }], impacts: [{ tick: 1, lap: 1, command: 'BOX', timeDelta: 1, positionDelta: 0 }] });
    store().setSeed('  silverstone-7  ');
    store().startRace();
    const s = store();
    expect(s.screen).toBe('race');
    expect(s.seed).toBe('silverstone-7');
    expect(s.race).toEqual(createRace('silverstone-7'));
    expect(s.prevRace).toBeNull();
    expect(s.inputs).toEqual([]);
    expect(s.calls).toEqual([]);
    expect(s.impacts).toEqual([]);
  });

  it('falls back to DEFAULT_SEED for an empty or blank seed', () => {
    store().setSeed('   ');
    store().startRace();
    expect(store().seed).toBe(DEFAULT_SEED);
    expect(race().seed).toBe(DEFAULT_SEED);
  });

  it('opens the radio with the lights-out driver line', () => {
    store().startRace();
    const radio = store().radio;
    expect(radio).toHaveLength(1);
    expect(radio[0]).toMatchObject({ id: 1, tick: 0, lap: 1, speaker: 'driver' });
  });
});

describe('live race == simulateRace(seed, inputs)', () => {
  const plan: Plan[] = [
    { tick: 0, cmd: 'PUSH' },                                  // before the first step (lights out)
    { tick: 400, cmd: 'PLAN_B' },
    { tick: 900, cmd: 'SAVE_TYRES' },                         // two calls in one tick …
    { tick: 900, cmd: 'BOX' },                                // … applied in issue order
    { tick: 1200, cmd: 'UNKNOWN', source: 'voice', transcript: 'banana' },
    { tick: 1500, cmd: 'BOX' },                               // BOX twice: queue …
    { tick: 1501, cmd: 'BOX' },                               // … then cancel
    { tick: 2000, cmd: 'DEFEND', source: 'voice', transcript: 'defend defend' },
    { tick: 2600, cmd: 'COPY' },
  ];

  it('replays the live race exactly from the recorded inputs', () => {
    const final = play(plan);
    const inputs = store().inputs;
    expect(inputs).toEqual<CommandInput[]>([
      { tick: 0, command: 'PUSH' },
      { tick: 400, command: 'PLAN_B' },
      { tick: 900, command: 'SAVE_TYRES' },
      { tick: 900, command: 'BOX' },
      { tick: 1500, command: 'BOX' },
      { tick: 1501, command: 'BOX' },
      { tick: 2000, command: 'DEFEND' },
      { tick: 2600, command: 'COPY' },
    ]);
    expect(final.phase).toBe('finished');
    expect(final).toEqual(simulateRace(DEFAULT_SEED, inputs));
    // The calls really changed the race (the equality above is not vacuous).
    expect(final).not.toEqual(simulateRace(DEFAULT_SEED, []));
    // Every recorded command was applied at its tick, in order.
    const applied = final.eventLog
      .filter((e) => e.type === 'COMMAND_APPLIED')
      .map((e) => ({ tick: e.tick, command: e.command }));
    expect(applied).toEqual(inputs);
  });

  it('is identical when played twice with the same seed and calls', () => {
    const a = play(plan);
    const radioA = store().radio;
    const b = play(plan);
    expect(b).toEqual(a);
    expect(store().radio).toEqual(radioA); // radio stream is per race and seeded too
  });

  it('never mutates the previous race state', () => {
    store().startRace();
    advanceTo(50);
    const before = structuredClone(race());
    store().issueCommand('BOX', 'keyboard');
    store().advance();
    expect(store().prevRace).toEqual(before);
    expect(race().tick).toBe(51);
  });
});

describe('issueCommand', () => {
  it('records an UNKNOWN in calls and radio, but never in inputs', () => {
    store().startRace();
    advanceTo(10);
    store().issueCommand('UNKNOWN', 'voice', '  banana split  ');
    const s = store();
    expect(s.inputs).toEqual([]);
    expect(s.calls).toEqual([{ tick: 10, lap: 1, command: 'UNKNOWN', source: 'voice', transcript: 'banana split' }]);
    const [engineer, driver] = s.radio.slice(-2);
    expect(engineer).toMatchObject({ speaker: 'engineer', text: 'banana split', tick: 10 });
    expect(driver?.speaker).toBe('driver');
  });

  it('logs the engineer phrase for a keyboard call and a driver reply', () => {
    store().startRace();
    advanceTo(5);
    store().issueCommand('BOX', 'keyboard');
    const s = store();
    expect(s.inputs).toEqual([{ tick: 5, command: 'BOX' }]);
    expect(s.calls.at(-1)).toEqual({ tick: 5, lap: 1, command: 'BOX', source: 'keyboard', transcript: null });
    const [engineer, driver] = s.radio.slice(-2);
    expect(engineer).toMatchObject({ speaker: 'engineer', text: ENGINEER_PHRASES.BOX });
    expect(driver?.speaker).toBe('driver');
    expect(driver?.text.length).toBeGreaterThan(0);
    // Radio ids are unique and increasing.
    const ids = s.radio.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort((x, y) => x - y)).toEqual(ids);
  });

  it('is ignored on the start screen, after the flag and on the debrief', () => {
    store().issueCommand('PUSH', 'keyboard');
    expect(store().calls).toEqual([]);

    store().startRace();
    finish();
    const radioLen = store().radio.length;
    store().issueCommand('PUSH', 'keyboard');
    expect(store().calls).toEqual([]);
    expect(store().inputs).toEqual([]);
    expect(store().radio).toHaveLength(radioLen);

    useGameStore.setState({ screen: 'debrief' });
    store().issueCommand('BOX', 'keyboard');
    expect(store().calls).toEqual([]);
  });

  it('records nothing once the player has taken the flag, while others still race', () => {
    store().startRace();
    advanceTo(100);
    store().issueCommand('PUSH', 'keyboard');
    while (race().phase === 'racing' && race().cars[PLAYER_ID]?.finishTime === null) store().advance();
    expect(race().cars[PLAYER_ID]?.finishTime).not.toBeNull();
    expect(race().phase).toBe('racing'); // the field is still running: the loop would accept calls
    const before = { inputs: store().inputs, calls: store().calls, radio: store().radio };
    store().issueCommand('BOX', 'keyboard');
    store().handleTranscript('push push');
    expect(store().inputs).toBe(before.inputs);
    expect(store().calls).toBe(before.calls);
    expect(store().radio).toBe(before.radio);
    // The debrief still pairs every recorded call with exactly one input.
    const final = finish();
    expect(store().inputs).toEqual([{ tick: 100, command: 'PUSH' }]);
    expect(final).toEqual(simulateRace(DEFAULT_SEED, store().inputs));
  });
});

describe('advance', () => {
  it('is a no-op outside a running race', () => {
    store().advance();
    expect(store().race).toBeNull();

    store().startRace();
    const finished = finish();
    store().advance();
    expect(store().race).toBe(finished);

    useGameStore.setState({ screen: 'debrief' });
    store().advance();
    expect(store().race).toBe(finished);
  });

  it('does nothing for a race state that this store did not start', () => {
    store().startRace();
    useGameStore.setState({ race: createRace('someone-else') });
    const foreign = store().race;
    store().advance();
    expect(store().race).toBe(foreign);
  });

  it('keeps the race screen on the chequered flag (the loop moves to the debrief)', () => {
    store().startRace();
    finish();
    expect(store().screen).toBe('race');
    expect(store().prevRace?.phase).toBe('racing');
  });

  it('adds unprompted driver lines from race events', () => {
    store().startRace();
    finish();
    const drivers = store().radio.filter((l) => l.speaker === 'driver');
    expect(drivers.length).toBeGreaterThan(1); // lights out + at least the finish
    expect(drivers.at(-1)?.lap).toBe(15);
  });
});

describe('handleTranscript', () => {
  it('parses the transcript and routes it as a voice call', () => {
    store().startRace();
    advanceTo(20);
    store().setVoice({ ptt: 'thinking' });
    store().handleTranscript(' Box, box. ');
    const s = store();
    expect(s.voice.ptt).toBe('off');
    expect(s.calls).toEqual([{ tick: 20, lap: 1, command: 'BOX', source: 'voice', transcript: 'Box, box.' }]);
    expect(s.inputs).toEqual([{ tick: 20, command: 'BOX' }]);
    expect(s.radio.at(-2)).toMatchObject({ speaker: 'engineer', text: 'Box, box.' });
  });

  it('records nonsense as UNKNOWN (say again) without an input', () => {
    store().startRace();
    store().handleTranscript('the weather is lovely');
    expect(store().calls.map((c) => c.command)).toEqual(['UNKNOWN']);
    expect(store().inputs).toEqual([]);
  });

  it('only turns the indicator off for an empty transcript', () => {
    store().startRace();
    store().setVoice({ ptt: 'thinking' });
    store().handleTranscript('   ');
    expect(store().voice.ptt).toBe('off');
    expect(store().calls).toEqual([]);
  });

  it('does not interrupt a new live press', () => {
    store().startRace();
    store().setVoice({ ptt: 'live' });
    store().handleTranscript('push');
    expect(store().voice.ptt).toBe('live');
    expect(store().calls).toHaveLength(1);
  });

  it('is dropped after the race (start screen or debrief)', () => {
    store().setVoice({ ptt: 'thinking' });
    store().handleTranscript('box');
    expect(store().voice.ptt).toBe('off');
    expect(store().calls).toEqual([]);

    store().startRace();
    store().backToStart();
    store().handleTranscript('box');
    expect(store().calls).toEqual([]);
  });
});

describe('setVoice / backToStart', () => {
  it('merges voice patches', () => {
    store().setVoice({ model: 'loading', progress: 40 });
    store().setVoice({ mic: 'unavailable' });
    expect(store().voice).toEqual({ ...INITIAL_VOICE, model: 'loading', progress: 40, mic: 'unavailable' });
  });

  it('returns to start, clears the race and keeps seed and voice', () => {
    store().setSeed('imola');
    store().setVoice({ model: 'ready', mic: 'ready' });
    store().startRace();
    advanceTo(3);
    store().issueCommand('PUSH', 'keyboard');
    store().backToStart();
    const s = store();
    expect(s.screen).toBe('start');
    expect(s.race).toBeNull();
    expect(s.prevRace).toBeNull();
    expect(s.inputs).toEqual([]);
    expect(s.seed).toBe('imola');
    expect(s.voice.model).toBe('ready');
    expect(s.voice.mic).toBe('ready');
  });
});

describe('debrief and impacts', () => {
  const plan: Plan[] = [
    { tick: 100, cmd: 'PUSH' },
    { tick: 700, cmd: 'BOX' },
    { tick: 800, cmd: 'UNKNOWN', source: 'voice', transcript: 'uh' },
    { tick: 1800, cmd: 'SAVE_TYRES' },
  ];

  it('moves to the debrief after the hold, then fills one impact per input', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const finished = play(plan);
    scheduleDebrief(finished);
    scheduleDebrief(finished); // once per race

    vi.advanceTimersByTime(DEBRIEF_HOLD_MS - 1);
    expect(store().screen).toBe('race');
    vi.advanceTimersByTime(1);
    expect(store().screen).toBe('debrief');
    expect(store().impacts).toEqual([]); // the debrief paints "analysing…" first

    vi.runAllTimers();
    const { inputs, impacts } = store();
    expect(inputs).toHaveLength(3);
    expect(impacts).toHaveLength(inputs.length);
    expect(impacts).toEqual(evaluateCalls(DEFAULT_SEED, inputs));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('never moves a new race or the start screen to the debrief', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const finished = play(plan);
    scheduleDebrief(finished);
    store().backToStart();
    vi.runAllTimers();
    expect(store().screen).toBe('start');

    const again = play(plan);
    scheduleDebrief(again);
    store().startRace(); // same seed, new race
    vi.runAllTimers();
    expect(store().screen).toBe('race');
    expect(store().impacts).toEqual([]);
  });

  it('drops stale impacts when the player leaves the debrief before they land', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const finished = play(plan);
    scheduleDebrief(finished);
    vi.advanceTimersByTime(DEBRIEF_HOLD_MS);
    expect(store().screen).toBe('debrief');
    store().startRace(); // "race again" before the 0 ms analysis timer
    vi.runAllTimers();
    expect(store().screen).toBe('race');
    expect(store().impacts).toEqual([]);
    expect(store().inputs).toEqual([]);
  });

  it('computeImpacts writes nothing unless the finished race is on the debrief', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const finished = play(plan);
    computeImpacts(finished); // still on the race screen
    vi.runAllTimers();
    expect(store().impacts).toEqual([]);
    useGameStore.setState({ screen: 'debrief' });
    computeImpacts(finished);
    expect(store().impacts).toEqual([]); // never synchronous: the debrief paints first
    vi.runAllTimers();
    expect(store().impacts).toHaveLength(store().inputs.length);
  });
});
