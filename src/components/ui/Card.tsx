import type { ReactNode } from "react";

/**
 * The inset panel everything on a tab is built from: the surface a step
 * lighter than the window, a hairline, and the specular top edge that makes
 * it read as a machined plate rather than a rectangle of a slightly
 * different grey.
 *
 * The two toned variants are for a card that is *reporting* something -
 * the active stage, a stage that is holding - and they tint the hairline and
 * add a faint inner wash rather than changing the surface. A card whose
 * background changed colour would compete with the state word inside it.
 */
const TONE = {
  default: "border-hairline shadow-specular",
  active:
    "border-ok-line shadow-[inset_0_1px_0_rgba(255,255,255,0.06),inset_0_0_28px_rgba(52,199,89,0.05)]",
  warn: "border-warn-line shadow-[inset_0_1px_0_rgba(255,255,255,0.06),inset_0_0_28px_rgba(255,149,0,0.05)]",
} as const;

export function Card({
  children,
  className,
  tone = "default",
}: {
  children: ReactNode;
  className?: string;
  tone?: "default" | "active" | "warn";
}) {
  return (
    <div
      className={`rounded-lg border bg-card ${TONE[tone]}${className ? ` ${className}` : ""}`}
    >
      {children}
    </div>
  );
}
