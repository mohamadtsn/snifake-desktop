import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Sheet } from "@/components/Sheet";
import { TunnelEditor } from "@/components/TunnelEditor";
import { RoutingEditor } from "@/components/RoutingEditor";
import type { Routing, TunnelMode, TunnelProfile, TunnelStore } from "@/types";

/** A blank tunnel pre-filled with the values that are right most of the time. */
function blankTunnel(): TunnelProfile {
  return {
    id: "",
    name: "",
    protocol: "vless",
    credential: "",
    remote_host: "",
    path: "/",
    sni: "",
    alpn: ["h3", "h2", "http/1.1"],
    fingerprint: "chrome",
    allow_insecure: false,
  };
}

type View =
  | { kind: "list" }
  | { kind: "editor"; profile: TunnelProfile; isNew: boolean }
  | { kind: "routing" };

/**
 * The same spring as `ProfileSheet`. Repeated as a constant rather than
 * imported because it is a value `DESIGN.md` owns, not a module boundary —
 * but if a third drawer appears, promote it.
 */
const LIST_SPRING = { type: "spring", stiffness: 520, damping: 42, mass: 1 } as const;

/**
 * The tunnel drawer. Three pushed views where the profile drawer has two:
 * list, one tunnel, and the routing policy that applies to all of them.
 *
 * Everything else is deliberately identical to `ProfileSheet` — same
 * `Sheet`, same push positions, same spring, same three-slot header, same
 * 420 ms reset delay. A user should not be able to tell the two were built
 * at different times.
 */
export function TunnelSheet({
  open,
  onOpenChange,
  store,
  listen,
  connectIp,
  runningId,
  saving,
  onSelect,
  onSave,
  onDelete,
  onSaveRouting,
  onAdoptAddress,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  store: TunnelStore;
  /** The running SNI listener, shown read-only in the editor. */
  listen: { host: string; port: number } | null;
  connectIp: string | null;
  /** The tunnel the engine is currently running, if any. */
  runningId: string | null;
  saving: boolean;
  onSelect: (id: string) => void;
  onSave: (t: TunnelProfile) => void;
  onDelete: (id: string) => void;
  onSaveRouting: (patch: {
    mode: TunnelMode;
    proxy_host: string;
    proxy_port: number;
    routing: Routing;
  }) => void;
  onAdoptAddress: (ip: string, port: number) => void;
}) {
  const [view, setView] = useState<View>({ kind: "list" });

  function close() {
    onOpenChange(false);
    // Reset only after the exit animation has cleared, so the list does not
    // flash into view on the way out.
    window.setTimeout(() => setView({ kind: "list" }), 420);
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (next) onOpenChange(true);
        else close();
      }}
    >
      {/* All three views stay mounted so the horizontal push can animate. */}
      <div className="sheet-view" data-position={view.kind === "list" ? "current" : "behind"}>
        <header className="flex shrink-0 items-center gap-2 px-4 pb-3">
          <button
            type="button"
            onClick={close}
            className="text-faint hover:text-text flex items-center gap-1.5 text-[10px] uppercase transition-colors focus-visible:outline-none"
            style={{ letterSpacing: "var(--track-engrave)" }}
          >
            <svg
              viewBox="0 0 12 12"
              className="size-2.5"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.6}
              strokeLinecap="round"
              aria-hidden
            >
              <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" />
            </svg>
            Close
          </button>
          <h2
            className="text-dim flex-1 text-center text-[10px] uppercase"
            style={{ letterSpacing: "var(--track-engrave)" }}
          >
            Tunnels
          </h2>
          <button
            type="button"
            onClick={() => setView({ kind: "editor", profile: blankTunnel(), isNew: true })}
            className="chip text-live border-live/45 hover:border-live h-7 px-2.5"
          >
            + New
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-4">
          <ul className="flex flex-col">
            <AnimatePresence initial={false}>
              {store.tunnels.map((t) => {
                const isActive = t.id === store.active_id;
                const isRunning = t.id === runningId;
                return (
                  <motion.li
                    key={t.id}
                    layout
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    transition={LIST_SPRING}
                    className="border-line flex items-stretch border-b"
                  >
                    <button
                      type="button"
                      onClick={() => onSelect(t.id)}
                      aria-current={isActive ? "true" : undefined}
                      className="hover:bg-hover flex min-w-0 flex-1 items-center gap-3 py-2.5 pr-2 pl-1 text-left transition-colors duration-[var(--dur-fast)] focus-visible:outline-none"
                    >
                      <span
                        className="h-7 w-[2px] shrink-0 rounded-[1px]"
                        style={{
                          background: isRunning
                            ? "var(--color-live)"
                            : isActive
                              ? "var(--color-beam)"
                              : "transparent",
                        }}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1">
                        <span
                          className={`block truncate text-[12.5px] ${isActive ? "text-text" : "text-dim"}`}
                        >
                          {t.name}
                        </span>
                        <span
                          dir="ltr"
                          className="text-faint mt-1 block truncate text-left text-[10px]"
                        >
                          {t.protocol} &middot; {t.remote_host}
                          {t.path}
                        </span>
                      </span>
                      {isRunning && (
                        <span
                          className="text-live shrink-0 text-[9px] uppercase"
                          style={{ letterSpacing: "var(--track-engrave)" }}
                        >
                          Live
                        </span>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => setView({ kind: "editor", profile: t, isNew: false })}
                      aria-label={`Edit ${t.name}`}
                      className="text-faint hover:bg-hover hover:text-text flex w-9 shrink-0 items-center justify-center text-[14px] transition-colors duration-[var(--dur-fast)] focus-visible:outline-none"
                    >
                      &rsaquo;
                    </button>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ul>

          {store.tunnels.length === 0 && (
            /* No tunnel configured is the state the app ships in, not a
               failure, so it says what to do rather than apologising. */
            <p className="text-faint prose-face px-1 py-4 text-[11px] leading-relaxed">
              No tunnels yet. Add one, or paste a link into a new tunnel&rsquo;s Import box.
            </p>
          )}

          {/* Policy is not a tunnel, so it sits below the list rather than
              in it, and pushes its own view like the editor does. */}
          <button
            type="button"
            onClick={() => setView({ kind: "routing" })}
            className="chip mt-3 h-9 w-full justify-between px-2.5"
          >
            <span>Routing &amp; mode</span>
            <span className="text-faint" aria-hidden>
              &rsaquo;
            </span>
          </button>
        </div>
      </div>

      <div className="sheet-view" data-position={view.kind === "editor" ? "current" : "ahead"}>
        {view.kind === "editor" && (
          <TunnelEditor
            key={view.profile.id || "new"}
            profile={view.profile}
            isNew={view.isNew}
            listen={listen}
            connectIp={connectIp}
            onCancel={() => setView({ kind: "list" })}
            onSave={(t) => {
              onSave(t);
              setView({ kind: "list" });
            }}
            onAdoptAddress={onAdoptAddress}
            // Unlike profiles, the last tunnel may be deleted: "no tunnel
            // configured" is a valid state, because the stage is optional.
            onDelete={
              view.isNew
                ? undefined
                : () => {
                    onDelete(view.profile.id);
                    setView({ kind: "list" });
                  }
            }
          />
        )}
      </div>

      <div className="sheet-view" data-position={view.kind === "routing" ? "current" : "ahead"}>
        {view.kind === "routing" && (
          <RoutingEditor
            store={store}
            saving={saving}
            onBack={() => setView({ kind: "list" })}
            onSave={(patch) => {
              onSaveRouting(patch);
              setView({ kind: "list" });
            }}
          />
        )}
      </div>
    </Sheet>
  );
}
