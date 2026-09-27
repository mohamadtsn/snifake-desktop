import { Icon } from "@/components/ui/Icon";
import { StatusDot } from "@/components/ui/StatusDot";
import { activeRoute } from "@/lib/readouts";
import type { Store } from "@/types";

/**
 * 36px of fixed chrome. Two readouts, both real.
 *
 * The left one is the slot the mockup filled with `SYSTEM BUS: 42,891
 * PKTS/S`. There are no packet counters in the engine, so it says what is
 * actually known: which profile is active and where it points. The right one
 * says the tray is live, which is the one thing a user who is about to press
 * the close glyph needs to know.
 */
export function StatusFooter({ store, closeToTray }: { store: Store | null; closeToTray: boolean }) {
  return (
    <footer
      data-tauri-drag-region
      className="flex h-[var(--h-footer)] shrink-0 items-center justify-between border-t border-hairline bg-surface px-4"
    >
      <div className="flex min-w-0 items-center gap-2">
        <Icon name="lan" size={13} className="text-t3" />
        <span className="mono truncate text-note text-t2">
          {store ? activeRoute(store) : "loading"}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <StatusDot tone="ok" size={6} />
        <span className="mono text-note text-t3">
          {closeToTray ? "Tray menu active" : "Close quits"}
        </span>
      </div>
    </footer>
  );
}
