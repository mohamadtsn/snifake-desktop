import type { ReactNode } from "react";

const TONE = {
  neutral: "bg-raised text-t2 border-hairline",
  ok: "bg-ok-soft text-ok border-ok-line",
  warn: "bg-warn-soft text-warn border-warn-line",
  bad: "bg-bad-soft text-bad border-bad-line",
  accent: "bg-accent-soft text-accent border-accent-line",
} as const;

/**
 * A fact about the thing next to it, in one or two words: `TRAY MODE`,
 * `CORE REQUIRED`, `ACTIVE`, `v2.1.0`.
 *
 * Mono and uppercase by default because almost every badge here is a machine
 * word - a state, a version, a mode - and tracking it out is what stops
 * nine uppercase characters from reading as a shout.
 */
export function Badge({
  children,
  tone = "neutral",
  mono = true,
}: {
  children: ReactNode;
  tone?: "neutral" | "ok" | "warn" | "bad" | "accent";
  mono?: boolean;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-xs border px-[6px] py-[3px] text-micro font-medium uppercase tracking-[0.04em] ${
        mono ? "mono" : ""
      } ${TONE[tone]}`}
    >
      {children}
    </span>
  );
}
