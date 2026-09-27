const TONE = {
  off: "var(--color-t4)",
  ok: "var(--color-ok)",
  warn: "var(--color-warn)",
  bad: "var(--color-bad)",
} as const;

/**
 * The pip beside a state word. It never appears alone: every state that has
 * a colour also has a word next to it, because colour is not a channel every
 * reader has.
 *
 * `glow` is the one place in the application where something glows, and it
 * means exactly one thing - this state is live right now.
 */
export function StatusDot({
  tone,
  size = 8,
  glow = false,
}: {
  tone: "off" | "ok" | "warn" | "bad";
  size?: 6 | 8;
  glow?: boolean;
}) {
  return (
    <span
      aria-hidden
      className="inline-block shrink-0 rounded-full"
      style={{
        width: size,
        height: size,
        // `color` rather than only `background` so the glow can be
        // `currentColor` and the two can never fall out of step.
        color: TONE[tone],
        background: "currentColor",
        boxShadow: glow ? "0 0 6px currentColor" : undefined,
      }}
    />
  );
}
