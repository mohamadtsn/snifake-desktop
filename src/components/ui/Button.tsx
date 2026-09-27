import type { ButtonHTMLAttributes, ReactNode } from "react";

const VARIANTS = {
  /** The one action a surface exists for. At most one per footer. */
  primary:
    "bg-accent text-white font-semibold shadow-lift hover:bg-[#1a87ff] active:bg-[#0069db]",
  /** Everything else that is a real action: Cancel, Restore Defaults, + New. */
  secondary:
    "bg-raised-dim border border-hairline text-t1 font-medium shadow-lift hover:bg-raised",
  /** A control that is mostly a glyph, or an action inside a dense row. */
  ghost: "text-t2 font-medium hover:bg-raised-dim hover:text-t1",
  /** Destructive, and only ever confirmed. */
  danger: "bg-bad text-white font-semibold shadow-lift hover:bg-[#ff5b51]",
} as const;

const SIZES = {
  sm: "h-[24px] px-[10px] text-note gap-[5px]",
  md: "h-[30px] px-[15px] text-body gap-[6px]",
  /** Square, for a single glyph. Matches the header's gear exactly. */
  icon: "size-[28px] text-body",
} as const;

/**
 * Every button in the workbench.
 *
 * The press state is a 1% scale down rather than a colour change, because a
 * control that moves under the finger is the one piece of tactile vocabulary
 * a pointer interface has; and it is `transform`, so it costs no layout.
 *
 * `disabled` is the real attribute, never a class: a greyed-out control that
 * still fires is worse than no control, and `aria-disabled` alone leaves it
 * clickable. Where a disabled control needs to explain itself, the caller
 * gives it a `title` - which is why nothing here swallows one.
 */
export function Button({
  variant = "secondary",
  size = "md",
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof VARIANTS;
  size?: keyof typeof SIZES;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`inline-flex shrink-0 items-center justify-center rounded-sm whitespace-nowrap transition-[background-color,color,transform] duration-(--dur-press) ease-(--ease-out) active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 disabled:active:scale-100 ${
        VARIANTS[variant]
      } ${SIZES[size]}${className ? ` ${className}` : ""}`}
      {...rest}
    >
      {children}
    </button>
  );
}
