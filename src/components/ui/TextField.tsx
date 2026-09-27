import type { ReactNode } from "react";
import { undoIntent, useUndoHistory } from "@/lib/undo";
import { FIELD_INPUT, FieldRow } from "./FieldRow";

/**
 * A labelled text input with its own undo stack.
 *
 * The stack is not decoration: Ctrl+Z works through a controlled React
 * input in Chrome but *not* under WebKitGTK, which is the webview this
 * application actually ships on Linux. A field owning its own history
 * behaves the same on all three platforms and adds redo. See
 * `src/lib/undo.ts`.
 *
 * Every value here is a hostname, an address or a port, so the input is
 * always `dir="ltr"` and left-read whatever the surrounding UI language is,
 * and mono wherever the value lines up in a column.
 */
export function TextField({
  label,
  value,
  onChange,
  error,
  hint,
  mono = true,
  placeholder,
  icon,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string | null;
  hint?: ReactNode;
  mono?: boolean;
  placeholder?: string;
  /** A glyph inside the field, for a value that needs a category marker. */
  icon?: ReactNode;
  disabled?: boolean;
}) {
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
    <FieldRow label={label} hint={hint} error={error}>
      <span className="relative block">
        {icon ? (
          <span className="pointer-events-none absolute top-1/2 left-[10px] -translate-y-1/2 text-t3">
            {icon}
          </span>
        ) : null}
        <input
          value={value}
          onChange={(e) => {
            history.record(e.target.value);
            onChange(e.target.value);
          }}
          onKeyDown={onKeyDown}
          disabled={disabled}
          placeholder={placeholder}
          spellCheck={false}
          autoComplete="off"
          dir="ltr"
          aria-invalid={error ? true : undefined}
          className={`${FIELD_INPUT} text-left ${mono ? "mono" : ""} ${icon ? "pl-[30px]" : ""}`}
        />
      </span>
    </FieldRow>
  );
}
