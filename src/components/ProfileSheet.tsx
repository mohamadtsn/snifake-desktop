import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Sheet } from "@/components/Sheet";
import { ProfileEditor } from "@/components/ProfileEditor";
import { Profile, Store } from "@/types";

/** A blank profile pre-filled with the values that are right most of the time. */
function blankProfile(): Profile {
  return {
    id: "",
    name: "",
    LISTEN_HOST: "127.0.0.1",
    LISTEN_PORT: 40443,
    CONNECT_IP: "",
    CONNECT_PORT: 443,
    FAKE_SNI: "",
  };
}

type View = { kind: "list" } | { kind: "editor"; profile: Profile; isNew: boolean };

/**
 * One spring for every layout move in the app, so a row entering, a row
 * leaving and the list closing a gap all move with the same physical
 * vocabulary. A spring rather than a curve because these get interrupted:
 * deleting two profiles quickly must not queue two 300ms tweens.
 */
const LIST_SPRING = { type: "spring", stiffness: 520, damping: 42, mass: 1 } as const;

/**
 * The drawer. Since switching profiles moved onto the rail, this is now
 * purely a management surface: add, edit, delete. Rows are still tappable
 * to select, because a list you cannot select from is a surprise.
 */
export function ProfileSheet({
  open,
  onOpenChange,
  store,
  runningId,
  onSelect,
  onSave,
  onDelete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  store: Store;
  /** The profile the engine is currently running, if any. */
  runningId: string | null;
  onSelect: (id: string) => void;
  onSave: (profile: Profile) => void;
  onDelete: (id: string) => void;
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
      {/* Both views stay mounted so the horizontal push can animate. */}
      <div className="sheet-view" data-position={view.kind === "list" ? "current" : "behind"}>
        <header className="flex shrink-0 items-center gap-2 px-4 pb-3">
          <h2
            className="text-dim flex-1 text-[10px] uppercase"
            style={{ letterSpacing: "var(--track-engrave)" }}
          >
            Profiles
          </h2>
          <button
            type="button"
            onClick={() => setView({ kind: "editor", profile: blankProfile(), isNew: true })}
            className="chip text-live border-live/45 hover:border-live h-7 px-2.5"
          >
            + New
          </button>
        </header>

        <ul className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-4">
          {/* AnimatePresence is the one thing CSS cannot do here: React has
              already unmounted a deleted row by the time a transition could
              run. The row leaves first, then `layout` closes the gap — that
              ordering is what reads as physical. */}
          <AnimatePresence initial={false}>
            {store.profiles.map((p) => {
              const isActive = p.id === store.active_id;
              const isRunning = p.id === runningId;
              return (
                <motion.li
                  key={p.id}
                  layout
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={LIST_SPRING}
                  className="border-line flex items-stretch border-b"
                >
                  <button
                    type="button"
                    onClick={() => onSelect(p.id)}
                    aria-current={isActive ? "true" : undefined}
                    className="hover:bg-hover flex min-w-0 flex-1 items-center gap-3 py-2.5 pr-2 pl-1 text-left transition-colors duration-[var(--dur-fast)] focus-visible:outline-none"
                  >
                    {/* A 2px rule, not a dot. The running profile is marked
                        by a lit edge on the row, the same way the rail marks
                        it with a lit border. */}
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
                        {p.name}
                      </span>
                      <span
                        dir="ltr"
                        className="text-faint mt-1 block truncate text-left text-[10px]"
                      >
                        {p.LISTEN_HOST}:{p.LISTEN_PORT} &rarr; {p.CONNECT_IP}:{p.CONNECT_PORT}
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
                    onClick={() => setView({ kind: "editor", profile: p, isNew: false })}
                    aria-label={`Edit ${p.name}`}
                    className="text-faint hover:bg-hover hover:text-text flex w-9 shrink-0 items-center justify-center text-[14px] transition-colors duration-[var(--dur-fast)] focus-visible:outline-none"
                  >
                    &rsaquo;
                  </button>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      </div>

      <div className="sheet-view" data-position={view.kind === "editor" ? "current" : "ahead"}>
        {view.kind === "editor" && (
          <ProfileEditor
            key={view.profile.id || "new"}
            profile={view.profile}
            isNew={view.isNew}
            onCancel={() => setView({ kind: "list" })}
            onSave={(p) => {
              onSave(p);
              setView({ kind: "list" });
            }}
            onDelete={
              view.isNew || store.profiles.length <= 1
                ? undefined
                : () => {
                    onDelete(view.profile.id);
                    setView({ kind: "list" });
                  }
            }
          />
        )}
      </div>
    </Sheet>
  );
}
