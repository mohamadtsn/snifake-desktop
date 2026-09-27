/**
 * Turning two cumulative readings into a rate.
 *
 * The engine sends totals, not deltas, so a dropped line cannot corrupt
 * the number. The cost is that the rate is derived here - and the
 * interesting half is every case where it cannot be: one sample, no
 * elapsed time, or counters that went backwards because the stage
 * restarted. Each of those returns `null`, which renders as a dash.
 */
export interface Sample {
  up: number;
  down: number;
  /** `Date.now()` when this sample arrived. */
  at: number;
}

export interface Rate {
  /** Bytes per second, or `null` when no rate can be derived. */
  up: number | null;
  down: number | null;
}

const NONE: Rate = { up: null, down: null };

export function rateBetween(previous: Sample | null, current: Sample): Rate {
  if (!previous) return NONE;

  const seconds = (current.at - previous.at) / 1000;
  // Two samples inside the same millisecond, or a clock that moved
  // backwards. Either way there is nothing to divide by.
  if (seconds <= 0) return NONE;

  const up = current.up - previous.up;
  const down = current.down - previous.down;
  // Counters only ever climb within one run, so a decrease means the stage
  // restarted underneath us and the previous sample belongs to a run that
  // no longer exists.
  if (up < 0 || down < 0) return NONE;

  return { up: up / seconds, down: down / seconds };
}

const UNITS = ["B", "KB", "MB", "GB", "TB"];

function scale(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  // Whole bytes read as bytes; anything scaled gets one decimal, which is
  // enough to see a meter move without the width jumping every tick.
  return unit === 0 ? `${Math.round(value)} ${UNITS[0]}` : `${value.toFixed(1)} ${UNITS[unit]}`;
}

/** A dash, never "0 B/s": zero is a claim that nothing moved, and a dash
 *  is the absence of a measurement. `DESIGN.md` 4.1. */
export function formatRate(bytesPerSecond: number | null): string {
  if (bytesPerSecond === null) return "—";
  return `${scale(bytesPerSecond)}/s`;
}

export function formatTotal(bytes: number | null): string {
  if (bytes === null) return "—";
  return scale(bytes);
}
