import { useEffect, useState } from "react";
import { ProxyState, STATE_COLOR, STATE_TEXT, formatUptime } from "@/types";

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
export function StatusPanel({ state, since }: { state: ProxyState; since: number | null }) {
  const uptime = useUptime(state === "running" ? since : null);

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
