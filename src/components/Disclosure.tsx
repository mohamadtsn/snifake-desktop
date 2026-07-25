import { ReactNode } from "react";
import { Collapsible } from "@base-ui/react/collapsible";
import { ChevronRight } from "lucide-react";

/**
 * Base UI's Collapsible unmounts its panel when fully closed, which is the
 * whole point here: with Activity closed, the log list does not exist in the
 * DOM at all. It also publishes the measured panel height as
 * --collapsible-panel-height, so the open/close animation in theme.css needs
 * no JS measurement.
 */
export function Disclosure({
  label,
  summary,
  badge,
  open,
  onOpenChange,
  children,
}: {
  label: string;
  summary?: ReactNode;
  badge?: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Collapsible.Root open={open} onOpenChange={onOpenChange} className="raised">
      <Collapsible.Trigger className="group flex w-full items-center gap-2.5 rounded-[var(--radius-card)] px-3.5 py-3 text-left transition-colors duration-150 hover:bg-raised-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60">
        <ChevronRight
          className="size-3.5 shrink-0 text-faint transition-transform duration-200 [transition-timing-function:var(--ease-sheet)] group-data-[panel-open]:rotate-90"
          aria-hidden
        />
        {/* Small text gets a touch of positive tracking; display type gets
            negative. One fixed letter-spacing would be wrong somewhere. */}
        <span className="text-[10px] font-medium tracking-[0.085em] text-dim uppercase">
          {label}
        </span>
        <span className="flex-1" />
        {badge !== undefined && badge > 0 && !open && (
          <span className="rounded-full bg-brand/18 px-1.5 py-0.5 font-mono text-[10px] leading-none text-brand">
            {badge > 99 ? "99+" : badge}
          </span>
        )}
        {summary && !open && (
          <span className="truncate font-mono text-[11px] text-faint">{summary}</span>
        )}
      </Collapsible.Trigger>
      <Collapsible.Panel className="disclosure-panel">
        <div className="px-3.5 pt-0.5 pb-3.5">{children}</div>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}
