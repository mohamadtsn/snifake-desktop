import type { ReactNode } from "react";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Button } from "./Button";
import { Icon } from "./Icon";

/**
 * A question with two answers: quit, delete, stop the link while the tunnel
 * is up, and the generic error (whose only answer is "I have read it").
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
}) {
  const danger = tone === "danger";
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[14px] transition-opacity duration-(--dur-panel) ease-(--ease-out) data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <AlertDialog.Popup className="fixed top-1/2 left-1/2 z-50 flex w-[420px] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-hairline-strong bg-card shadow-modal outline-none transition-[opacity,scale] duration-(--dur-panel) ease-(--ease-out) data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-starting-style:scale-[0.98] data-starting-style:opacity-0">
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

          <footer className="flex shrink-0 items-center justify-end gap-3 border-t border-hairline bg-raised-dim/90 px-6 pt-[13px] pb-[12px]">
            {/* Cancel first in the DOM, so it is the first thing Tab reaches
                and the first thing a screen reader reads. The destructive
                answer is never the easy one. */}
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
          </footer>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
