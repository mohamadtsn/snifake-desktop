/**
 * Drag physics for the profile sheet.
 *
 * Kept as pure functions with no DOM access so the numbers that decide how
 * the sheet *feels* are the one part of the frontend that is actually
 * tested. The projection formula is Apple's exponential-decay form from the
 * Designing Fluid Interfaces sample code, not the textbook v²/2a: they
 * behave noticeably differently at the speeds a thumb produces.
 */

export interface Sample {
  /** Pointer position along the drag axis, px. */
  y: number;
  /** Timestamp, ms. */
  t: number;
}

/** How much of the recent pointer history to average over, ms. */
const VELOCITY_WINDOW = 100;

/** Fraction of the sheet's height that counts as "far enough" on its own. */
const DISTANCE_RATIO = 0.5;

/** Returns px/ms along the drag axis. Positive is downward. */
export function velocityFrom(samples: Sample[]): number {
  if (samples.length < 2) return 0;
  const last = samples[samples.length - 1];
  // Walk back to the oldest sample still inside the window, so a pause
  // before release reads as a stop rather than as the original flick.
  let first = samples[0];
  for (let i = samples.length - 1; i >= 0; i--) {
    first = samples[i];
    if (last.t - samples[i].t >= VELOCITY_WINDOW) break;
  }
  const dt = last.t - first.t;
  if (dt <= 0) return 0;
  return (last.y - first.y) / dt;
}

/**
 * Where a flick would come to rest, in px of further travel.
 * `velocity` is px/ms; the ×1000 converts to the px/s the formula expects.
 */
export function project(velocity: number, decelerationRate = 0.998): number {
  return ((velocity * 1000) / 1000) * (decelerationRate / (1 - decelerationRate));
}

/**
 * Progressive resistance past a boundary. Real things slow before they stop;
 * an invisible wall reads as the interface having frozen.
 */
export function rubberband(overshoot: number, dimension: number, constant = 0.55): number {
  if (overshoot === 0) return 0;
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

/**
 * Commit or spring back. Decided on the *projected* resting point, so a
 * quick flick dismisses without having to travel the distance, and a long
 * drag the user stopped short of the threshold springs back.
 */
export function shouldDismiss(offset: number, velocity: number, height: number): boolean {
  if (velocity < 0) return false; // still heading back up, the user changed their mind
  return offset + project(velocity) > height * DISTANCE_RATIO;
}
