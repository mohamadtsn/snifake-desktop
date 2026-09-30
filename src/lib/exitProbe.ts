import type { ExitInfo } from "@/types";

/**
 * When to ask where the tunnel comes out. The first wait lets the core's
 * first connections settle; the back-off covers a slow first handshake;
 * then it gives up and says so rather than retrying forever.
 */
export const PROBE_DELAYS = [2500, 4000, 8000, 16000];
/** A long-lived tunnel is re-checked quietly; the exit can change under a CDN. */
export const REFRESH_MS = 10 * 60 * 1000;

export type ExitProbe =
  | { status: "off" }
  | { status: "checking" }
  | { status: "ok"; info: ExitInfo }
  | { status: "failed"; reason: string };

export type ProbeEvent =
  | { type: "run" }
  | { type: "off" }
  | { type: "ok"; info: ExitInfo }
  | { type: "failed"; reason: string; final: boolean };

export function nextDelay(attempt: number): number | null {
  return PROBE_DELAYS[attempt] ?? null;
}

/** A new run never shows the previous run's exit; a failed refresh keeps
 *  the last good reading rather than blanking a working tunnel. */
export function reduce(p: ExitProbe, e: ProbeEvent): ExitProbe {
  switch (e.type) {
    case "run":
      return { status: "checking" };
    case "off":
      return { status: "off" };
    case "ok":
      return { status: "ok", info: e.info };
    case "failed":
      if (p.status === "ok") return p;
      return e.final ? { status: "failed", reason: e.reason } : p;
  }
}
