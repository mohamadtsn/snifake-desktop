import { useId } from "react";
import { undoIntent, useUndoHistory } from "@/lib/undo";

/**
 * Host and port are one address, so they share a line with the port narrow:
 * the shape of the control mirrors the shape of the value. Every field
 * keeps a visible label — a placeholder is an example, not a label. Values
 * are hostnames, IPs and ports, so inputs are always LTR and left-read
 * whatever the surrounding UI language is.
 */
export function Field({
  label,
  value,
  onChange,
  error,
  numeric,
  placeholder,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  numeric?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const id = useId();
  // The field owns its undo stack rather than relying on the webview's —
  // see src/lib/undo.ts for why.
  const history = useUndoHistory(value);

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const intent = undoIntent(e);
    if (!intent) return;
    const restored = intent === "undo" ? history.undo() : history.redo();
    // Nothing of ours to restore: leave the event alone so the platform
    // still gets its shot at it.
    if (restored === undefined) return;
    e.preventDefault();
    onChange(restored);
  }

  return (
    <div className={`flex min-w-0 flex-col gap-1.5 ${className ?? ""}`}>
      <label
        htmlFor={id}
        className="text-faint text-[9.5px] uppercase"
        style={{ letterSpacing: "var(--track-engrave)" }}
      >
        {label}
      </label>
      <input
        id={id}
        dir="ltr"
        inputMode={numeric ? "numeric" : "text"}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          history.record(e.target.value);
          onChange(e.target.value);
        }}
        onKeyDown={onKeyDown}
        aria-invalid={error ? true : undefined}
        className={[
          "inset text-text placeholder:text-ghost h-9 w-full px-2.5 text-left text-[12px]",
          "transition-[border-color,box-shadow] duration-[var(--dur-fast)]",
          "[transition-timing-function:var(--ease-out)] focus:outline-none",
          error
            ? "border-st-error/70 focus:border-st-error"
            : "hover:border-edge focus:border-live",
        ].join(" ")}
      />
      {/* The message replaces nothing and shifts nothing: the row keeps its
          height whether or not it is in error. */}
      <span className="text-st-error h-[11px] text-[10px] leading-none">{error ?? ""}</span>
    </div>
  );
}
