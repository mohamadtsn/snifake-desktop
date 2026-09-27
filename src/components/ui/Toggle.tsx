import { Switch } from "@base-ui/react/switch";
import { motion } from "motion/react";
import { THUMB_SPRING } from "@/lib/motion";

const SIZES = {
  md: { w: 36, h: 20, thumb: 16 },
  sm: { w: 30, h: 17, thumb: 13 },
} as const;

/**
 * The pill switch.
 *
 * Base UI's `Switch` rather than a styled button: it supplies
 * `role="switch"`, `aria-checked`, Space/Enter, and the form integration, all
 * of which are the parts that are easy to get quietly wrong.
 *
 * On is the accent blue, not the green: green in this application means
 * *running*, and a preference being enabled is a selection, not a state. Both
 * the mockups and `DESIGN.md` 2.5 put selection on blue.
 *
 * `aria-label` is required rather than optional because a pill switch has no
 * text of its own, and the row's title is not automatically its name.
 */
export function Toggle({
  checked,
  onChange,
  disabled = false,
  size = "md",
  "aria-label": ariaLabel,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  size?: "sm" | "md";
  "aria-label": string;
}) {
  const s = SIZES[size];
  const travel = s.w - s.thumb - 4;
  return (
    <Switch.Root
      checked={checked}
      onCheckedChange={onChange}
      disabled={disabled}
      aria-label={ariaLabel}
      className="relative shrink-0 rounded-full p-[2px] shadow-sunken transition-colors duration-(--dur-fast) ease-(--ease-out) disabled:cursor-default disabled:opacity-40"
      style={{
        width: s.w,
        height: s.h,
        background: checked ? "var(--color-accent)" : "rgba(255,255,255,0.15)",
      }}
    >
      <Switch.Thumb
        render={
          <motion.span
            // `x`, not `left`: only transform and opacity animate, so the
            // slide costs no layout.
            animate={{ x: checked ? travel : 0 }}
            transition={THUMB_SPRING}
            className="block rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.35)]"
            style={{ width: s.thumb, height: s.thumb }}
          />
        }
      />
    </Switch.Root>
  );
}
