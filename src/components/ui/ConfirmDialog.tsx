import type { ReactNode } from "react";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Button } from "./Button";
import { Icon } from "./Icon";

/**
 * A question with two answers - or, with `tertiary`, three: quit, delete,
 * stop the link while the tunnel is up, and the generic error (whose only
 * answer is "I have read it").
 *
 * `AlertDialog`, not `Dialog`: it does not dismiss on an outside press,
 * because a stray click on the backdrop must not answer a question. `Esc`
 * does dismiss it, and that is deliberate rather than an oversight - `Esc`
 * maps to Cancel, Cancel is the safe answer in all four of these dialogs, and
 * a modal that traps the key every desktop user reaches for reads as broken.
 *
 * `details` is the inset fact table: the two stages and their states in the
 * quit dialog, the profile being deleted in the delete dialog. It is there so
 * the dialog can state what it is about instead of asking the user to
 * remember.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  tone,
  icon,
  title,
  badge,
  description,
  details,
  cancelLabel,
  confirmLabel,
  onConfirm,
  busy = false,
  tertiary,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tone: "neutral" | "danger";
  icon: string;
  title: string;
  badge?: ReactNode;
  description: ReactNode;
  details?: ReactNode;
  /** `null` for a message with one answer - an error the user can only
   *  acknowledge. Two buttons that do the same thing is a question that is
   *  not being asked. */
  cancelLabel: string | null;
  confirmLabel: string;
  onConfirm: () => void;
  /** Work is running and neither answer applies any more. Both buttons say
   *  so rather than looking live and doing nothing. */
  busy?: boolean;
  /** A third answer that is neither cancel nor confirm - "Save and leave".
   *  It sits alone on the leading edge, apart from the pair, so it reads
   *  as a different kind of answer rather than a third option in a row.
   *  `disabledReason` disables it and says why, in its `title`. */
  tertiary?: {
    label: string;
    icon?: string;
    onClick: () => void;
    disabledReason?: string | null;
  };
}) {
  const danger = tone === "danger";
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[14px] transition-opacity duration-(--dur-panel) ease-(--ease-out) data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <AlertDialog.Popup
          // Wider with a third answer: three buttons at 420px leave no gap
          // between the lone answer and the pair, and the gap is the point.
          className={`fixed top-1/2 left-1/2 z-50 flex ${tertiary ? "w-[480px]" : "w-[420px]"} -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-hairline-strong bg-card shadow-modal outline-none transition-[opacity,scale] duration-(--dur-panel) ease-(--ease-out) data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-starting-style:scale-[0.98] data-starting-style:opacity-0`}
        >
          <div className="flex flex-col gap-3 px-6 pt-5 pb-4">
            <div className="flex items-center gap-3">
              <span
                className={`flex size-[32px] shrink-0 items-center justify-center rounded-md border shadow-sunken ${
                  danger
                    ? "border-bad-line bg-bad-soft text-bad"
                    : "border-accent-line bg-accent-soft text-accent"
                }`}
              >
                <Icon name={icon} size={16} />
              </span>
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <AlertDialog.Title className="truncate text-row font-semibold tracking-[-0.325px] text-t1">
                  {title}
                </AlertDialog.Title>
                {badge}
              </div>
            </div>

            <AlertDialog.Description className="text-body leading-[18px] text-t2">
              {description}
            </AlertDialog.Description>

            {details ? (
              <div className="rounded-md border border-hairline bg-inset px-3 py-[10px]">
                {details}
              </div>
            ) : null}
          </div>

          <footer
            className={`flex shrink-0 items-center gap-3 border-t border-hairline bg-raised-dim/90 px-6 pt-[13px] pb-[12px] ${
              tertiary ? "justify-between" : "justify-end"
            }`}
          >
            {tertiary ? (
              // Accent-tinted, not `primary`: it is a safe answer, but not
              // the dialog's answer, and a second solid button would split
              // the eye between two defaults. The `title` is on a wrapper:
              // a disabled button takes no pointer events, so a title on the
              // button itself would never show on the one state it explains.
              <span title={tertiary.disabledReason ?? undefined}>
                <Button
                  variant="tinted"
                  disabled={busy || Boolean(tertiary.disabledReason)}
                  onClick={tertiary.onClick}
                >
                  {tertiary.icon ? <Icon name={tertiary.icon} size={14} /> : null}
                  {tertiary.label}
                </Button>
              </span>
            ) : null}
            <span className="flex items-center gap-3">
              {/* Cancel before the confirm answer in the DOM, so Tab reaches
                it first and a screen reader reads it first. The destructive
                answer is never the easy one. A `tertiary` precedes both, and
                is always a safe answer. */}
              {cancelLabel === null ? null : (
                <AlertDialog.Close
                  render={
                    <Button variant="secondary" disabled={busy}>
                      {cancelLabel}
                    </Button>
                  }
                />
              )}
              <Button variant={danger ? "danger" : "primary"} disabled={busy} onClick={onConfirm}>
                {confirmLabel}
              </Button>
            </span>
          </footer>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
