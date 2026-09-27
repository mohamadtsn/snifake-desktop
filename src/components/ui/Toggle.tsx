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
 * Two tones, and the difference is not decoration. `accent` (blue) is a
 * *choice* being recorded: a preference, a safeguard. `ok` (green) is a
 * *stage that is running*, which is what green means everywhere else in this
 * application (`DESIGN.md` 1.1). The mockups use both, and use them exactly
 * this way: the dashboard's two stage switches are green, every switch in
 * Preferences is blue.
 *
 * `aria-label` is required rather than optional because a pill switch has no
 * text of its own, and the row's title is not automatically its name.
 */
export function Toggle({
  checked,
  onChange,
  disabled = false,
  size = "md",
  tone = "accent",
  "aria-label": ariaLabel,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  size?: "sm" | "md";
  tone?: "accent" | "ok";
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
        background: checked
          ? tone === "ok"
            ? "var(--color-ok)"
            : "var(--color-accent)"
          : "rgba(255,255,255,0.15)",
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
