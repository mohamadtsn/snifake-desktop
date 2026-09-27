import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import { StatusDot } from "@/components/ui/StatusDot";
import { LIST_SPRING } from "@/lib/motion";
import { middleTruncate } from "@/lib/readouts";

export interface ListItem {
  id: string;
  name: string;
  /** The line under the name: the fake SNI, or the tunnel's remote host. */
  subject: string;
  /** The mono foot: the inbound address, or the protocol signature. */
  foot: string;
}

/**
 * The master column. One card per configuration, the active one marked.
 *
 * The empty state names the button that fixes it. A blank panel is how the
 * old interface answered "you have no profiles", and the answer to that
 * question is a sentence and an arrow, not an absence.
 */
export function ProfileList({
  kind,
  items,
  activeId,
  runningId,
  onSelect,
  selectedId,
}: {
  kind: "sni" | "tunnel";
  items: ListItem[];
  activeId: string | null;
  /** The one actually carrying traffic, which is not always the active one. */
  runningId: string | null;
  onSelect: (id: string) => void;
  selectedId: string | null;
}) {
  const reduce = useReducedMotion();
  const label = kind === "sni" ? "link" : "tunnel";

  return (
    <div className="flex w-[300px] shrink-0 flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2 px-[2px]">
        <h2 className="text-note font-semibold tracking-[0.55px] text-t2 uppercase">
          Configured profiles
        </h2>
        <span className="mono text-micro tracking-[0.04em] text-t3 uppercase">
          {activeId ? `1 active ${label}` : `no active ${label}`}
        </span>
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed border-hairline-strong bg-card px-4 py-5">
          <Icon name="add_circle" size={20} className="text-t3" />
          <p className="text-row font-medium text-t1">
            No {kind === "sni" ? "SNI link" : "tunnel"} configured yet
          </p>
          <p className="text-note leading-[16.5px] text-t2">
            {kind === "sni"
              ? "An SNI link is the first stage, and everything starts with one. Press New above to add it."
              : "The tunnel is an optional second stage. Press New above, or Import a share link."}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <AnimatePresence initial={false}>
            {items.map((item) => {
              const selected = item.id === selectedId;
              const active = item.id === activeId;
              return (
                <motion.button
                  key={item.id}
                  type="button"
                  layout={reduce ? false : "position"}
                  initial={reduce ? false : { opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduce ? { opacity: 0 } : { opacity: 0, y: -6 }}
                  transition={LIST_SPRING}
                  onClick={() => onSelect(item.id)}
                  aria-current={selected ? "true" : undefined}
                  className={`flex flex-col gap-2 rounded-lg border bg-card px-3 py-[11px] text-left shadow-specular transition-colors duration-(--dur-fast) ease-(--ease-out) ${
                    selected ? "border-accent-line" : "border-hairline hover:border-hairline-strong"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <StatusDot tone={active ? "ok" : "off"} size={8} glow={item.id === runningId} />
                    <span className="min-w-0 flex-1 truncate text-row font-medium text-t1">
                      {middleTruncate(item.name, 26)}
                    </span>
                    {active ? <Badge tone="ok">active</Badge> : null}
                  </span>
                  <span className="flex items-center gap-[6px] pl-[16px]">
                    <Icon name={kind === "sni" ? "dns" : "vpn_key"} size={12} className="text-t3" />
                    <span className="mono min-w-0 truncate text-note text-t2">{item.subject}</span>
                  </span>
                  <span className="flex items-center justify-between gap-2 border-t border-hairline pt-2">
                    <span className="mono min-w-0 truncate text-note text-t3">{item.foot}</span>
                    {item.id === runningId ? (
                      <span className="flex shrink-0 items-center gap-[5px]">
                        <StatusDot tone="ok" size={6} glow />
                        <span className="text-note text-ok">Bound</span>
                      </span>
                    ) : (
                      <span className="shrink-0 text-note text-t3">Standby</span>
                    )}
                  </span>
                </motion.button>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      <p className="mt-auto flex items-start gap-2 rounded-md border border-hairline bg-inset px-3 py-[10px] text-note leading-[16.5px] text-t2">
        <Icon name="info" size={14} className="mt-[1px] shrink-0 text-t3" />
        One profile per category is active at a time. Switching while the engine is running
        restarts it into the new profile, with no password prompt.
      </p>
    </div>
  );
}
