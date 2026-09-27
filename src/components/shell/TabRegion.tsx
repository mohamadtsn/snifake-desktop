import { useEffect, useRef, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { TAB_TWEEN } from "@/lib/motion";

export type Tab = "telemetry" | "sockets" | "config" | "about";

export const TABS: { value: Tab; label: string }[] = [
  { value: "telemetry", label: "Telemetry" },
  { value: "sockets", label: "Sockets" },
  { value: "config", label: "Config" },
  { value: "about", label: "About" },
];

/**
 * The only thing in the window that scrolls.
 *
 * One container rather than one per tab, because a scrollbar that belongs to
 * a panel rather than to the window is the tell that a desktop application
 * was built as a web page. Sockets and both Config tabs overflow 760px by
 * design - the mockups are clipped there and the clipped content is real.
 *
 * Each tab's `scrollTop` is remembered in a ref, so coming back to a tab
 * returns to where it was left. In a ref and not in state: nothing renders
 * differently because of a scroll position, and putting it in state would
 * re-render the whole tab on every wheel event.
 */
export function TabRegion({ tab, children }: { tab: Tab; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const tops = useRef<Partial<Record<Tab, number>>>({});
  const previous = useRef<Tab>(tab);
  const reduce = useReducedMotion();

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (previous.current !== tab) {
      tops.current[previous.current] = node.scrollTop;
      previous.current = tab;
      node.scrollTop = tops.current[tab] ?? 0;
    }
  }, [tab]);

  return (
    <main ref={ref} className="tab-scroll min-h-0 flex-1">
      {/* Keyed on the tab so React replaces the subtree rather than trying
          to reconcile four unrelated panels into each other - and so the
          entrance runs on every change. */}
      <motion.div
        key={tab}
        initial={reduce ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={TAB_TWEEN}
      >
        {children}
      </motion.div>
    </main>
  );
}
