import { ProxyState, STATE_ACTION } from "@/types";

/**
 * The only control that starts or stops the engine.
 *
 * A latching rocker rather than a round button: width is what tells you
 * this is the primary control, and a rectangle can carry a word. It is lit
 * (solid phosphor green, dark ink) exactly when the engine is up, so the
 * switch doubles as the panel's main lamp.
 *
 * Not keyed on `state` — a remount would drop keyboard focus at precisely
 * the moment the user is watching the panel change.
 */
export function PowerSwitch({
  state,
  onStart,
  onStop,
}: {
  state: ProxyState;
  onStart: () => void;
  onStop: () => void;
}) {
  // Stop stays reachable while starting: an elevation prompt that never
  // returns must not leave the only exit greyed out.
  const active = state === "running" || state === "starting";

  return (
    <button
      type="button"
      onClick={active ? onStop : onStart}
      aria-pressed={active}
      className="switch"
      data-state={state}
      data-lit={state === "running" ? "" : undefined}
    >
      <span className="flex items-center gap-2.5">
        <PowerGlyph active={active} />
        {STATE_ACTION[state]}
      </span>
    </button>
  );
}

/**
 * The IEC power mark. One path in both states: the gap in the ring closes
 * and the stem retracts when active, so the glyph morphs rather than
 * swaps. Authored rather than imported because no icon set ships a mark
 * that interpolates between two states.
 */
function PowerGlyph({ active }: { active: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-3.5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      aria-hidden
    >
      <path
        d="M7.2 7.2a6.8 6.8 0 1 0 9.6 0"
        style={{
          transition: "stroke-dasharray var(--dur-panel) var(--ease-in-out)",
          strokeDasharray: active ? "34 0" : "26 8",
        }}
      />
      <path
        d="M12 3 V 11"
        style={{
          transformOrigin: "12px 3px",
          transition: "transform var(--dur-panel) var(--ease-in-out)",
          transform: active ? "scaleY(0.4)" : "scaleY(1)",
        }}
      />
    </svg>
  );
}
