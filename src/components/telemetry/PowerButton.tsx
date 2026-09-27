import { motion, useReducedMotion } from "motion/react";
import { Icon } from "@/components/ui/Icon";
import { THUMB_SPRING } from "@/lib/motion";

const COLOUR: Record<"ok" | "bad" | "warn" | "off", string> = {
  ok: "var(--color-ok)",
  bad: "var(--color-bad)",
  warn: "var(--color-warn)",
  off: "var(--color-t3)",
};

/**
 * The primary control of a stage, and the reason it replaced a switch in the
 * card's corner: a toggle the size of a word is not the weight of the one
 * action the screen exists for. The author of this application had to hunt
 * for its predecessor.
 *
 * The halo *is* the state - it is the same colour as the status badge, so
 * the two cannot disagree - and it is drawn with `box-shadow` and colour
 * only, so it composites and costs no layout. Under reduced motion the halo
 * is still drawn and the press simply does not spring: the information
 * survives, the movement does not.
 */
export function PowerButton({
  engaged,
  tone,
  disabled,
  title,
  label,
  onClick,
}: {
  engaged: boolean;
  tone: "ok" | "bad" | "warn" | "off";
  disabled?: boolean;
  title?: string;
  /** The accessible name. The glyph is an image of a control, never a label. */
  label: string;
  onClick: () => void;
}) {
  const reduce = useReducedMotion();
  const colour = COLOUR[tone];

  return (
    <motion.button
      type="button"
      aria-label={label}
      aria-pressed={engaged}
      title={title}
      disabled={disabled}
      onClick={onClick}
      whileTap={reduce || disabled ? undefined : { scale: 0.94 }}
      transition={THUMB_SPRING}
      className="relative flex size-[56px] shrink-0 items-center justify-center rounded-full border border-hairline-strong bg-inset transition-[box-shadow,border-color,color] duration-(--dur-fast) ease-(--ease-out) disabled:opacity-45"
      style={{
        color: engaged ? colour : undefined,
        borderColor: engaged ? colour : undefined,
        boxShadow: engaged
          ? `0 0 0 1px ${colour}, 0 0 22px -4px ${colour}, inset 0 0 18px -8px ${colour}`
          : undefined,
      }}
    >
      <Icon name="power_settings_new" size={24} className={engaged ? undefined : "text-t3"} />
    </motion.button>
  );
}
