import { useEffect, useRef } from 'react';
import { getInterpolationAlpha } from '../state/loop';
import { useGameStore } from '../state/store';
import type { CarState, RaceState } from '../sim/types';
import { buildTrack, pointAt, type TrackPath } from './track';
import styles from './TrackCanvas.module.css';

interface Palette {
  bg: string; track: string; trackWet: string; kerb: string; line: string;
  car: string; player: string; pit: string; label: string; sc: string;
  trackWidth: number; carR: number; playerR: number; pitOffset: number;
  labelSize: number; font: string; pitAlpha: number;
  kerbW: number; lineW: number; lineOverhang: number; carOutline: number; labelGap: number;
}

function readPalette(): Palette {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string) => cs.getPropertyValue(name).trim();
  const n = (name: string, fallback: number) => {
    const x = parseFloat(v(name));
    return Number.isFinite(x) ? x : fallback;
  };
  return {
    bg: v('--canvas-bg'), track: v('--canvas-track'), trackWet: v('--canvas-track-wet'),
    kerb: v('--canvas-kerb'), line: v('--canvas-line'), car: v('--canvas-car'),
    player: v('--canvas-car-player'), pit: v('--canvas-car-pit'), label: v('--canvas-label'),
    sc: v('--canvas-sc'),
    trackWidth: n('--canvas-track-width', 1), carR: n('--canvas-car-radius', 1),
    playerR: n('--canvas-player-radius', 1), pitOffset: n('--canvas-pit-offset', 1),
    labelSize: n('--canvas-label-size', 1), font: v('--font-data'),
    pitAlpha: n('--opacity-pit-car', 1),
    kerbW: n('--canvas-kerb-width', 1), lineW: n('--canvas-line-width', 1),
    lineOverhang: n('--canvas-line-overhang', 1), carOutline: n('--canvas-car-outline', 1),
    labelGap: n('--canvas-label-gap', 1),
  };
}

/** Interpolated distance for a car between the previous and current tick. */
function carDistance(car: CarState, prev: RaceState | null, race: RaceState, alpha: number): number {
  const before = prev && prev.tick === race.tick - 1 ? prev.cars[car.id] : undefined;
  if (!before) return car.distance;
  return before.distance + (car.distance - before.distance) * alpha;
}

function draw(ctx: CanvasRenderingContext2D, track: TrackPath, pal: Palette, w: number, h: number, dpr: number) {
  const { race, prevRace } = useGameStore.getState();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = pal.bg;
  ctx.fillRect(0, 0, w, h);

  const pad = pal.trackWidth + pal.pitOffset + pal.playerR;
  const size = Math.max(0, Math.min(w, h) - pad * 2);
  // Stretch slightly to use wide containers, but keep corners readable.
  const sx = Math.min(w - pad * 2, size * 1.6);
  const sy = size;
  const ox = (w - sx) / 2;
  const oy = (h - sy) / 2;
  const X = (x: number) => ox + x * sx;
  const Y = (y: number) => oy + y * sy;

  const wet = race?.weather === 'wet';
  const sc = race?.safetyCar.active ?? false;

  // Track: kerb outline, then tarmac.
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  track.points.forEach((p, i) => (i === 0 ? ctx.moveTo(X(p.x), Y(p.y)) : ctx.lineTo(X(p.x), Y(p.y))));
  ctx.closePath();
  ctx.strokeStyle = sc ? pal.sc : pal.kerb;
  ctx.lineWidth = pal.trackWidth + pal.kerbW;
  ctx.stroke();
  ctx.strokeStyle = wet ? pal.trackWet : pal.track;
  ctx.lineWidth = pal.trackWidth;
  ctx.stroke();

  // Start/finish line across the track.
  const sf = pointAt(track, 0);
  const half = pal.trackWidth / 2 + pal.lineOverhang;
  ctx.beginPath();
  ctx.moveTo(X(sf.p.x) + sf.n.x * half, Y(sf.p.y) + sf.n.y * half);
  ctx.lineTo(X(sf.p.x) - sf.n.x * half, Y(sf.p.y) - sf.n.y * half);
  ctx.strokeStyle = pal.line;
  ctx.lineWidth = pal.lineW;
  ctx.lineCap = 'butt';
  ctx.stroke();

  if (!race) return;
  const alpha = getInterpolationAlpha();

  // Draw back-to-front by position so the leader and the player sit on top.
  const ids = [...race.order].reverse();
  let playerAt: { x: number; y: number; code: string } | null = null;
  for (const id of ids) {
    const car = race.cars[id];
    if (!car) continue;
    const d = carDistance(car, prevRace, race, alpha);
    const { p, n } = pointAt(track, d);
    const inPit = car.pitTimeRemaining > 0;
    const off = inPit ? pal.pitOffset : 0;
    const x = X(p.x) + n.x * off;
    const y = Y(p.y) + n.y * off;
    const r = car.isPlayer ? pal.playerR : pal.carR;

    ctx.globalAlpha = inPit || car.finishTime !== null ? pal.pitAlpha : 1;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = car.isPlayer ? pal.player : inPit ? pal.pit : pal.car;
    ctx.fill();
    ctx.lineWidth = pal.carOutline;
    ctx.strokeStyle = pal.bg;
    ctx.stroke();
    ctx.globalAlpha = 1;
    if (car.isPlayer) playerAt = { x, y, code: car.code };
  }

  if (playerAt) {
    ctx.font = `${pal.labelSize}px ${pal.font}`;
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = pal.label;
    ctx.fillText(playerAt.code, playerAt.x + pal.playerR + pal.labelGap, playerAt.y - pal.playerR / 2);
  }
}

/** Top-down circuit with interpolated car dots. Reads the store directly each frame; never re-renders React. */
export function TrackCanvas() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!wrap || !canvas || !ctx) return;

    const track = buildTrack();
    let pal = readPalette();
    let w = 0;
    let h = 0;
    let dpr = 1;

    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      dpr = window.devicePixelRatio || 1;
      w = rect.width;
      h = rect.height;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      pal = readPalette();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    let raf = 0;
    const frame = () => {
      draw(ctx, track, pal, w, h, dpr);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <div ref={wrapRef} className={styles.wrap}>
      <canvas ref={canvasRef} className={styles.canvas} role="img" aria-label="Track map with car positions. Your car is the large labelled dot." />
    </div>
  );
}
