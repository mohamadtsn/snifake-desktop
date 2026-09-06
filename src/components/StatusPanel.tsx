import { useEffect, useState } from "react";
import {
  ProxyState,
  STATE_COLOR,
  STATE_TEXT,
  TUNNEL_STATE_COLOR,
  TUNNEL_STATE_TEXT,
  TunnelState,
  formatUptime,
} from "@/types";

const SEGMENTS = 20;

/**
 * The readout. A twenty-segment bar, the condition word, and the elapsed
 * time since the engine came up.
 *
 * The bar encodes state and only state — there is deliberately no
 * throughput meter here, because the engine does not report bytes and a
 * bar that moves without data behind it is a lie the user cannot detect.
 * Everything the bar does (dark / filling / lit-with-scan / red) is driven
 * from CSS off `data-state`, so a running console costs no React renders.
 */
export function StatusPanel({
  state,
  since,
  tunnel,
  tunnelSince,
  tunnelMode,
}: {
  state: ProxyState;
  since: number | null;
  /** Absent when no tunnel is configured: the row does not exist then. */
  tunnel?: TunnelState;
  tunnelSince?: number | null;
  tunnelMode?: string;
}) {
  const uptime = useUptime(state === "running" ? since : null);
  // The same hook twice. Neither clock ticks unless its own stage is up.
  const tunnelUptime = useUptime(tunnel === "active" ? (tunnelSince ?? null) : null);

  return (
    <section className="flex shrink-0 flex-col gap-2.5">
      <h2 className="engrave">Status</h2>

      {/* The instrument face. This is the one place in the app that is
          allowed to take space: it is the reading the window exists to
          give, and everything below it is settings. */}
      <div className="panel flex flex-col gap-3.5 px-3.5 py-3.5">
        <div className="signal" data-state={state} role="img" aria-label={STATE_TEXT[state]}>
          {Array.from({ length: SEGMENTS }, (_, i) => (
            <span key={i} className="signal-seg" style={{ ["--i" as string]: i }} aria-hidden />
          ))}
        </div>

        <div className="flex items-end justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-2">
            <span
              className="text-faint text-[9px] uppercase"
              style={{ letterSpacing: "var(--track-engrave)" }}
            >
              Condition
            </span>
            <span
              className="truncate text-[26px] leading-none uppercase"
              style={{ letterSpacing: "var(--track-label)", color: STATE_COLOR[state] }}
            >
              {STATE_TEXT[state]}
            </span>
          </div>

          <div className="flex shrink-0 flex-col items-end gap-2">
            <span
              className="text-faint text-[9px] uppercase"
              style={{ letterSpacing: "var(--track-engrave)" }}
            >
              Uptime
            </span>
            {/* An em dash, not "00:00:00": a zeroed clock reads as a running
                clock that happens to be at zero. */}
            <span className="text-dim text-[16px] leading-none">{uptime ?? "—"}</span>
          </div>
        </div>

        {tunnel !== undefined && (
          <>
            {/* A hairline, not a card edge: this is one instrument with two
                readings, not two instruments stacked. */}
            <span className="bg-line h-px w-full" aria-hidden />

            {/* No second twenty-segment bar. The bar is the instrument's
                reading, and giving the tunnel an identical one says the two
                stages are equals — which is exactly what the smaller type
                is here to deny. Measured, it also cost 240px of overflow at
                the window's own height, pushing the channel selectors below
                the fold. One lit block carries the colour instead: the same
                signal vocabulary, at the weight a subordinate line earns. */}
            <div className="flex items-end justify-between gap-3">
              <div className="flex min-w-0 flex-col gap-2">
                <span
                  className="text-faint text-[9px] uppercase"
                  style={{ letterSpacing: "var(--track-engrave)" }}
                >
                  Tunnel
                </span>
                {/* 20px against the link's 26px. The link is the primary
                    reading and the tunnel is subordinate to it; equal sizes
                    would say otherwise. */}
                <span
                  className="flex min-w-0 items-center gap-2 truncate text-[20px] leading-none uppercase"
                  style={{
                    letterSpacing: "var(--track-label)",
                    color: TUNNEL_STATE_COLOR[tunnel],
                  }}
                >
                  {/* A lamp, not one segment borrowed from the bar. Reusing
                      `.signal-seg` looked right until it was rendered: the
                      starting state animates a fill across the segments, so
                      a lone segment is dark for part of every cycle and the
                      lamp disagreed with the word beside it. A lamp that
                      contradicts its own readout is worse than no lamp.
                      Sized to the cap height of the 20px word. */}
                  <span
                    className="shrink-0 rounded-[1px]"
                    style={{ width: 8, height: 16, background: TUNNEL_STATE_COLOR[tunnel] }}
                    aria-hidden
                  />
                  {TUNNEL_STATE_TEXT[tunnel]}
                  {tunnelMode && tunnel === "active" && (
                    <span className="text-faint text-[11px]"> &middot; {tunnelMode}</span>
                  )}
                </span>
              </div>

              <div className="flex shrink-0 flex-col items-end gap-2">
                <span
                  className="text-faint text-[9px] uppercase"
                  style={{ letterSpacing: "var(--track-engrave)" }}
                >
                  Uptime
                </span>
                <span className="text-dim text-[14px] leading-none">{tunnelUptime ?? "—"}</span>
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

/**
 * Ticks once a second, and only while there is something to count. The
 * interval is torn down the instant the engine stops, so an idle console
 * schedules no timers at all.
 */
function useUptime(since: number | null): string | null {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (since === null) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [since]);

  return since === null ? null : formatUptime(now - since);
}
