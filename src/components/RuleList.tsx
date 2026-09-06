import { useMemo } from "react";
import { validateRuleList } from "@/lib/rules";

/**
 * One editable rule list.
 *
 * A textarea rather than a rail of typed rows, and the reason is the
 * common case: people arrive with a list of two hundred domains on the
 * clipboard. A structured builder turns that into two hundred interactions.
 * Here it is one paste, and the per-line validation underneath tells them
 * immediately which lines did not survive it.
 *
 * Errors are listed under the field rather than shown inline, because a
 * textarea cannot carry decoration per line without either a mirrored
 * overlay or a code editor, and both are more machinery than a settings
 * screen has any business owning.
 *
 * The border and label follow `Field` exactly rather than inventing a
 * second input style. This is the only multi-line input in the app, and
 * looking like a different kind of control would be a claim that it is one.
 */
export function RuleList({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const errors = useMemo(() => validateRuleList(value), [value]);
  const bad = errors
    .map((e, i) => (e ? { line: i + 1, message: e } : null))
    .filter((x): x is { line: number; message: string } => x !== null);

  return (
    <div className="flex flex-col gap-1.5">
      <label
        className="text-faint text-[9.5px] uppercase"
        style={{ letterSpacing: "var(--track-engrave)" }}
      >
        {label}
      </label>
      <p className="text-faint prose-face text-[10.5px] leading-relaxed">{hint}</p>
      <textarea
        dir="ltr"
        spellCheck={false}
        autoComplete="off"
        autoCorrect="off"
        rows={4}
        aria-invalid={bad.length > 0 ? true : undefined}
        className={[
          "inset text-text placeholder:text-ghost min-h-[76px] w-full resize-y px-2.5 py-2",
          "text-left text-[12px] leading-relaxed",
          "transition-[border-color,box-shadow] duration-[var(--dur-fast)]",
          "[transition-timing-function:var(--ease-out)] focus:outline-none",
          bad.length > 0
            ? "border-st-error/70 focus:border-st-error"
            : "hover:border-edge focus:border-live",
        ].join(" ")}
        value={value.join("\n")}
        onChange={(e) => onChange(e.target.value.split("\n"))}
      />
      {/* The height is reserved either way, so a message shifts nothing —
          the same call ProfileEditor's error line makes. */}
      <div className="min-h-[14px]">
        {bad.length > 0 && (
          <span className="text-st-error text-[10px] leading-none">
            Line {bad[0].line}: {bad[0].message}
            {bad.length > 1 && ` (+${bad.length - 1} more)`}
          </span>
        )}
      </div>
    </div>
  );
}
