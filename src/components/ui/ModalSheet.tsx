import { useRef, type ReactNode } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { Icon } from "./Icon";

/**
 * A place you go: Preferences, Import, Core setup.
 *
 * Base UI's `Dialog` rather than a hand-rolled overlay, because focus
 * trapping, `Esc`, scroll lock, the `aria-modal` wiring and returning focus
 * to whatever opened it are exactly the parts that are easy to ship broken.
 *
 * A sheet dismisses on `Esc` and on the scrim, and `ConfirmDialog` does not,
 * and that is the whole difference between the two: a sheet is somewhere you
 * are, so leaving it is free. A dialog asks a question, and a stray click on
 * the backdrop must not answer it.
 *
 * It portals to `<body>`, not into the shell. The old drawer portaled into
 * `.shell` so it stayed inside a 22px rounded bezel; the window is square and
 * opaque now, so there is no bezel to stay inside and the extra indirection
 * bought nothing.
 */
export function ModalSheet({
  open,
  onOpenChange,
  icon,
  title,
  subtitle,
  tabs,
  footer,
  children,
  width = 680,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  icon?: string;
  title: string;
  subtitle?: string;
  /** Rendered in the header, right of the title. */
  tabs?: ReactNode;
  footer: ReactNode;
  children: ReactNode;
  width?: number;
}) {
  const popupRef = useRef<HTMLDivElement>(null);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[14px] transition-opacity duration-(--dur-panel) ease-(--ease-out) data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup
          ref={popupRef}
          // Focus the sheet itself, not the first control in it. Base UI
          // otherwise lands on whatever is focusable first, which puts a
          // ring on the close button or on a tab nobody asked to change,
          // and reads as "you are about to press this" the moment the sheet
          // opens. Screen readers still get the title, because the popup is
          // labelled by it.
          initialFocus={popupRef}
          className="fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100vh-88px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-hairline-strong bg-surface shadow-modal outline-none transition-[opacity,scale] duration-(--dur-panel) ease-(--ease-out) data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-starting-style:scale-[0.98] data-starting-style:opacity-0"
          style={{ width }}
        >
          <header className="flex shrink-0 items-center justify-between gap-3 border-b border-hairline bg-raised-dim/70 px-5 pt-3 pb-[13px]">
            <div className="flex min-w-0 items-center gap-[10px]">
              {icon ? (
                <span className="flex size-[28px] shrink-0 items-center justify-center rounded-md border border-accent-line bg-accent-soft text-accent shadow-sunken">
                  <Icon name={icon} size={14} />
                </span>
              ) : null}
              <div className="min-w-0">
                <Dialog.Title className="truncate text-row font-semibold tracking-[-0.325px] text-t1">
                  {title}
                </Dialog.Title>
                {subtitle ? (
                  <Dialog.Description className="mono truncate text-mini leading-[10px] text-t2">
                    {subtitle}
                  </Dialog.Description>
                ) : null}
              </div>
            </div>
            {tabs}
            <Dialog.Close
              aria-label="Close"
              className="flex size-[24px] shrink-0 items-center justify-center rounded-full bg-raised-dim text-t2 transition-[background-color,color,transform] duration-(--dur-press) ease-(--ease-out) hover:bg-raised hover:text-t1 active:scale-[0.94]"
            >
              <Icon name="close" size={14} />
            </Dialog.Close>
          </header>

          <div className="tab-scroll flex min-h-0 flex-1 flex-col gap-5 px-6 py-4">
            {children}
          </div>

          <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-hairline bg-raised-dim/90 px-6 pt-[15px] pb-[14px]">
            {footer}
          </footer>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
