import type { ReactNode } from "react";

/**
 * The class every text input in the workbench wears, exported so a `select`
 * or a `textarea` can wear it too and there is still only one definition of
 * what an input looks like.
 *
 * `dir="ltr"` and left alignment are the caller's job on the element itself,
 * because they are about the *value* - a hostname, an IP, a port, a rule
 * line, never prose - and a component cannot know that from a class.
 */
export const FIELD_INPUT =
  "h-[32px] w-full rounded-md border border-hairline bg-inset px-[10px] text-row text-t1 " +
  "placeholder:text-t3 transition-[border-color,box-shadow] duration-(--dur-fast) ease-(--ease-out) " +
  "focus:border-accent focus:outline-none focus:shadow-[0_0_0_3px_rgba(0,122,255,0.3)] " +
  "disabled:cursor-default disabled:text-t3 disabled:opacity-60 " +
  "aria-[invalid=true]:border-bad aria-[invalid=true]:focus:shadow-[0_0_0_3px_rgba(255,69,58,0.3)]";

/**
 * Label above, hint on the label's line at the right, control, error below.
 *
 * The label is always visible - never a placeholder standing in for one,
 * because a placeholder disappears exactly when the user needs to check what
 * they are filling in.
 *
 * **The error line reserves its height whether or not there is an error.** A
 * message appearing must not push the rest of the form down: in a form where
 * validation runs per keystroke, that would make the page jump while someone
 * is typing.
 */
export function FieldRow({
  label,
  hint,
  error,
  mono = false,
  children,
  /** `false` for a control that is not a single form element - a segmented
   *  control is a group of buttons, and buttons inside a `<label>` are
   *  invalid and forward stray clicks. */
  labelled = true,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  mono?: boolean;
  children: ReactNode;
  labelled?: boolean;
}) {
  const Tag = labelled ? "label" : "div";
  return (
    <Tag className="block">
      <span className="mb-[6px] flex items-baseline justify-between gap-3">
        <span className="text-note font-medium text-t2">{label}</span>
        {hint ? <span className="text-note text-t3">{hint}</span> : null}
      </span>
      <span className={mono ? "mono block" : "block"}>{children}</span>
      <span className="mt-[4px] block min-h-[16px] text-note leading-[16px] text-bad">
        {error ?? ""}
      </span>
    </Tag>
  );
}
