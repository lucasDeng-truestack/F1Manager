/**
 * Circuit geometry for the canvas (pure, no DOM). A hand-placed closed loop in a unit box,
 * smoothed with Chaikin corner cutting and sampled by arc length, so a car's lap fraction
 * maps to a point at constant speed along the racing line. Point 0 is the start/finish line.
 */
export interface Pt { x: number; y: number }

// Loosely a fast, flowing circuit: long main straight, a chicane, a hairpin, sweepers.
const CONTROL: readonly Pt[] = [
  { x: 0.30, y: 0.86 }, { x: 0.62, y: 0.86 }, { x: 0.80, y: 0.84 }, { x: 0.86, y: 0.76 },
  { x: 0.80, y: 0.70 }, { x: 0.86, y: 0.62 }, { x: 0.94, y: 0.50 }, { x: 0.92, y: 0.30 },
  { x: 0.84, y: 0.16 }, { x: 0.70, y: 0.12 }, { x: 0.60, y: 0.22 }, { x: 0.62, y: 0.40 },
  { x: 0.52, y: 0.48 }, { x: 0.40, y: 0.38 }, { x: 0.34, y: 0.18 }, { x: 0.20, y: 0.12 },
  { x: 0.08, y: 0.24 }, { x: 0.08, y: 0.56 }, { x: 0.12, y: 0.78 }, { x: 0.20, y: 0.86 },
];

function chaikin(pts: readonly Pt[], iterations: number): Pt[] {
  let out = [...pts];
  for (let k = 0; k < iterations; k++) {
    const next: Pt[] = [];
    for (let i = 0; i < out.length; i++) {
      const a = out[i]!;
      const b = out[(i + 1) % out.length]!;
      next.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
      next.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    out = next;
  }
  return out;
}

export interface TrackPath {
  points: Pt[];       // closed polyline in unit space
  cumulative: number[]; // arc length at each point; cumulative[0] = 0
  length: number;
}

export function buildTrack(): TrackPath {
  // CONTROL[0]→[1] is the main straight, so the first smoothed point is on it (start/finish).
  const points = chaikin(CONTROL, 3);
  const cumulative: number[] = [0];
  for (let i = 1; i <= points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i % points.length]!;
    cumulative.push(cumulative[i - 1]! + Math.hypot(b.x - a.x, b.y - a.y));
  }
  return { points, cumulative, length: cumulative[points.length]! };
}

/** Lap fraction of a distance in laps; negative grid distances wrap to just behind the line. */
export function lapFraction(distance: number): number {
  const f = distance % 1;
  return f < 0 ? f + 1 : f;
}

/** Point and unit normal (pointing to the left of travel) at lap fraction `t` in [0,1). */
export function pointAt(track: TrackPath, t: number): { p: Pt; n: Pt } {
  const target = lapFraction(t) * track.length;
  const { points, cumulative } = track;
  let lo = 0;
  let hi = points.length;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cumulative[mid]! <= target) lo = mid; else hi = mid;
  }
  const a = points[lo]!;
  const b = points[(lo + 1) % points.length]!;
  const seg = cumulative[lo + 1]! - cumulative[lo]!;
  const u = seg > 0 ? (target - cumulative[lo]!) / seg : 0;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return { p: { x: a.x + dx * u, y: a.y + dy * u }, n: { x: dy / len, y: -dx / len } };
}
