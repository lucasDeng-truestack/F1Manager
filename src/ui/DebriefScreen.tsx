import { useMemo } from 'react';
import { LAPS, PLAYER_ID } from '../sim/constants';
import { useGameStore } from '../state/store';
import {
  COMMAND_LABEL, formatGap, formatPositionDelta, formatRaceTime, formatTimeDelta, impactTone, ordinal,
  pairCallsWithImpacts, type CallRow,
} from './format';
import styles from './DebriefScreen.module.css';

const TONE_CLASS = { gain: styles.gain, loss: styles.loss, neutral: styles.neutral } as const;

function Impact({ row }: { row: CallRow }) {
  if (row.kind === 'unknown') return <span className={styles.neutral}>Not understood — say again</span>;
  if (row.kind === 'pending') return <span className={styles.pending}>Analysing…</span>;
  const pos = formatPositionDelta(row.impact.positionDelta);
  return (
    <span className={TONE_CLASS[impactTone(row.impact)]}>
      {formatTimeDelta(row.impact.timeDelta)}
      {pos && <span className={styles.pos}> · {pos}</span>}
    </span>
  );
}

function Result() {
  const me = useGameStore((s) => s.race?.cars[PLAYER_ID]);
  const winnerId = useGameStore((s) => s.race?.order[0]);
  const winner = useGameStore((s) => (winnerId === undefined ? undefined : s.race?.cars[winnerId]));
  if (!me) return null;

  const gap = me.finishTime !== null && winner?.finishTime != null && winner.id !== me.id
    ? formatGap(me.finishTime - winner.finishTime)
    : null;

  return (
    <section className={styles.result} aria-label="Your result">
      <p className={styles.finish}>
        <span className={styles.k}>Finished</span>
        <span className={styles.big}>{ordinal(me.position)}</span>
      </p>
      <dl className={styles.stats}>
        <div><dt className={styles.k}>Race time</dt><dd>{me.finishTime !== null ? formatRaceTime(me.finishTime) : 'DNF'}</dd></div>
        <div><dt className={styles.k}>To winner</dt><dd>{gap ?? (me.position === 1 ? 'Winner' : '—')}</dd></div>
        <div><dt className={styles.k}>Pit stops</dt><dd>{me.pitStops}</dd></div>
        <div><dt className={styles.k}>Laps</dt><dd>{LAPS}</dd></div>
      </dl>
    </section>
  );
}

export function DebriefScreen() {
  const calls = useGameStore((s) => s.calls);
  const impacts = useGameStore((s) => s.impacts);
  const inputCount = useGameStore((s) => s.inputs.length);
  const startRace = useGameStore((s) => s.startRace);
  const backToStart = useGameStore((s) => s.backToStart);
  const seed = useGameStore((s) => s.seed);

  const rows = useMemo(() => pairCallsWithImpacts(calls, impacts, inputCount), [calls, impacts, inputCount]);
  const analysing = impacts.length !== inputCount;

  return (
    <main className={styles.screen}>
      <div className={styles.column}>
        <h1 className={styles.title}>Debrief</h1>
        <p className={styles.seed}>Seed <span>{seed}</span></p>
        <Result />

        <section aria-labelledby="calls-title" className={styles.calls}>
          <h2 id="calls-title" className={styles.h2}>
            Your calls {analysing && <span className={styles.pending} role="status">· analysing…</span>}
          </h2>
          {rows.length === 0 ? (
            <p className={styles.empty}>No calls this race. The driver did it all alone — try a box call next time.</p>
          ) : (
            <ol className={styles.list}>
              {rows.map((row, i) => (
                <li key={`${row.call.tick}-${i}`} className={styles.row}>
                  <span className={styles.lap}>L{row.call.lap}</span>
                  <span className={styles.what}>
                    <span className={styles.command}>{row.kind === 'unknown' ? '???' : COMMAND_LABEL[row.command]}</span>
                    <span className={styles.said}>
                      {row.call.source === 'voice' ? 'Voice' : 'Keys'}
                      {row.call.transcript && <> · “{row.call.transcript}”</>}
                    </span>
                  </span>
                  <span className={styles.impact}><Impact row={row} /></span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <div className={styles.actions}>
          <button type="button" className={styles.primary} onClick={() => startRace()}>Race again</button>
          <button type="button" className={styles.secondary} onClick={() => backToStart()}>New seed</button>
        </div>
      </div>
    </main>
  );
}
