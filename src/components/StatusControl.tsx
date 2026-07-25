import { Config, ProxyState, STATE_TEXT, STATE_SUBTITLE, STATE_ORB } from "@/types";

/**
 * Status and the primary action are one control, not two stacked ones. The
 * top row *is* the button: the orb and the label tell you where you are, the
 * chip tells you what pressing does. Below the hairline, the route the proxy
 * is (or would be) using — read-only, outside the button, so reading it never
 * risks toggling the proxy.
 */
function Route({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[62px_1fr] items-baseline gap-2">
      <span className="text-[10.5px] tracking-[0.04em] text-faint uppercase">{label}</span>
      <span className="truncate font-mono text-[11.5px] text-dim">{value}</span>
    </div>
  );
}

export function StatusControl({
  state,
  config,
  onStart,
  onStop,
}: {
  state: ProxyState;
  config: Config;
  onStart: () => void;
  onStop: () => void;
}) {
  // Stop stays reachable while starting — an elevation prompt that never
  // returns must not leave the only exit greyed out.
  const active = state === "running" || state === "starting";

  return (
    <div className="raised shrink-0 overflow-hidden">
      <button
        onClick={active ? onStop : onStart}
        aria-label={active ? "Stop the proxy" : "Start the proxy"}
        className={[
          "group flex w-full items-center gap-3.5 px-4 py-3.5 text-left",
          "transition-[background-color,transform] duration-150",
          "[transition-timing-function:var(--ease-out-quint)]",
          "hover:bg-raised-hover active:scale-[0.99]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60",
        ].join(" ")}
      >
        {/* key={state} remounts the orb and label together: it re-triggers the
            pop, and WebKitGTK otherwise leaves stale glyphs when text changes
            under a composited layer. The button itself is not keyed, so focus
            survives a state change. */}
        <div key={state} className="flex min-w-0 flex-1 items-center gap-3.5">
          <span
            className="orb shrink-0"
            data-state={state}
            style={{ ["--orb" as string]: STATE_ORB[state], ["--orb-size" as string]: "38px" }}
          />
          <span className="flex min-w-0 flex-col gap-1">
            <span className="text-[17px] leading-none font-semibold tracking-[-0.017em] text-text">
              {STATE_TEXT[state]}
            </span>
            <span className="truncate text-[11.5px] leading-none text-faint">
              {STATE_SUBTITLE[state]}
            </span>
          </span>
        </div>

        <span
          className={[
            "shrink-0 rounded-full px-3.5 py-1.5 text-[12px] font-semibold",
            "transition-colors duration-150",
            active
              ? "bg-st-error/14 text-st-error group-hover:bg-st-error/22"
              : "bg-brand text-white group-hover:bg-brand/90",
          ].join(" ")}
        >
          {active ? "Stop" : "Start"}
        </span>
      </button>

      <div className="mx-4 h-px bg-hairline" />

      <div className="flex flex-col gap-1.5 px-4 py-3">
        <Route label="Listen" value={`${config.LISTEN_HOST}:${config.LISTEN_PORT}`} />
        <Route label="Upstream" value={`${config.CONNECT_IP}:${config.CONNECT_PORT}`} />
        <Route label="SNI" value={config.FAKE_SNI} />
      </div>
    </div>
  );
}
