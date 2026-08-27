import type { ReactNode } from "react";
import { Collapsible } from "@base-ui/react/collapsible";

/**
 * The engraved section header, made pressable. It reads as another rule in
 * the panel until you hover it, which is the point: a console does not
 * grow a card around every group.
 *
 * Base UI's Collapsible unmounts its panel when fully closed — which is the
 * whole reason it is here, since that keeps five hundred log lines out of
 * the DOM. It also publishes the measured height as
 * --collapsible-panel-height, so the animation in theme.css needs no JS
 * measurement pass.
 */
export function Disclosure({
  label,
  badge,
  open,
  onOpenChange,
  children,
}: {
  label: string;
  badge?: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Collapsible.Root open={open} onOpenChange={onOpenChange}>
      <Collapsible.Trigger className="group hover:text-dim focus-visible:text-text flex w-full items-center gap-2 py-1.5 text-left transition-colors duration-[var(--dur-fast)] focus-visible:outline-none">
        <span
          className="text-faint group-hover:text-dim text-[8px] transition-transform duration-[var(--dur-panel)] [transition-timing-function:var(--ease-out)] group-data-[panel-open]:rotate-90"
          aria-hidden
        >
          ▶
        </span>
        <span
          className="text-faint group-hover:text-dim text-[9.5px] uppercase transition-colors"
          style={{ letterSpacing: "var(--track-engrave)" }}
        >
          {label}
        </span>
        <span className="bg-line h-px flex-1" aria-hidden />
        {badge !== undefined && badge > 0 && !open && (
          <span className="text-amber text-[10px] leading-none">
            {badge > 999 ? "999+" : badge}
          </span>
        )}
      </Collapsible.Trigger>
      <Collapsible.Panel className="disclosure-panel">
        <div className="pt-2">{children}</div>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}
