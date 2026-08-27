import { motion } from "motion/react";
import { ProxyState, STATE_ACTION, STATE_COLOR, STATE_TEXT } from "@/types";

/**
 * The one thing on the disc that a CSS transition cannot do. Pressing Stop
 * while the disc is still settling into `starting` has to reverse from the
 * velocity it currently has, not restart from a static value. A spring
 * carries velocity across an interruption; a transition does not.
 */
const DISC_SPRING = { type: "spring", stiffness: 400, damping: 30 } as const;

/**
 * The status indicator and the primary action are one object, not two
 * stacked ones: the colour tells you where you are, pressing changes it.
 * Nothing else in the app starts or stops the proxy.
 *
 * The button is deliberately not keyed on `state`: a remount would drop
 * keyboard focus every time the proxy changed state, which is exactly when
 * the user is watching. Only the label block below it is keyed, so it
 * cross-fades while focus stays put.
 */
export function PowerDisc({
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
    <div className="flex shrink-0 flex-col items-center gap-5 py-2">
      <button
        type="button"
        onClick={active ? onStop : onStart}
        aria-pressed={active}
        aria-label={active ? "Stop the proxy" : "Start the proxy"}
        className="disc-button rounded-full"
      >
        {/* Three nested transforms that compose rather than compete: the
            button carries the press scale, this wrapper carries the state
            spring, and .disc itself carries the breathe and shake keyframes.
            See DESIGN.md 6.5. */}
        <motion.span
          className="block"
          animate={{ scale: active ? 1 : 0.94, ["--halo" as string]: active ? 0.9 : 0.34 }}
          transition={DISC_SPRING}
          initial={false}
        >
          <span
            className="disc"
            data-state={state}
            style={{ ["--disc" as string]: STATE_COLOR[state] }}
          >
            {state === "starting" && <span className="disc-arc" aria-hidden />}
            <PowerGlyph active={active} />
          </span>
        </motion.span>
      </button>

      <div key={state} className="disc-label flex flex-col items-center gap-1.5">
        <span
          className="text-text text-[22px] leading-none font-semibold"
          style={{ letterSpacing: "var(--track-title)" }}
        >
          {STATE_TEXT[state]}
        </span>
        <span
          className="text-faint text-[12.5px] leading-none"
          style={{ letterSpacing: "var(--track-caption)" }}
        >
          {STATE_ACTION[state]}
        </span>
      </div>
    </div>
  );
}

/**
 * The IEC power glyph. One path in both states: the gap in the ring closes
 * and the stem retracts when active, so the icon morphs rather than swaps.
 * Authored rather than taken from lucide because no icon library ships a
 * glyph that interpolates between two states.
 */
function PowerGlyph({ active }: { active: boolean }) {
  return (
    <svg
      viewBox="0 0 48 48"
      className="relative size-[52px]"
      fill="none"
      stroke="rgba(255,255,255,0.94)"
      strokeWidth={3.4}
      strokeLinecap="round"
      aria-hidden
    >
      <path
        d="M14.5 15.5a13 13 0 1 0 19 0"
        style={{
          transition: "stroke-dasharray var(--dur-panel) var(--ease-in-out)",
          strokeDasharray: active ? "62 0" : "50 12",
        }}
      />
      <path
        d="M24 8 V 22"
        style={{
          transformOrigin: "24px 8px",
          transition: "transform var(--dur-panel) var(--ease-in-out)",
          transform: active ? "scaleY(0.42)" : "scaleY(1)",
        }}
      />
    </svg>
  );
}
