import { useState } from "react";
import { Check, MoreHorizontal, Plus } from "lucide-react";
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
    window.setTimeout(() => setView({ kind: "list" }), 450);
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
          <span
            className="text-text flex-1 text-[17px] font-semibold"
            style={{ letterSpacing: "var(--track-title)" }}
          >
            Profiles
          </span>
          <button
            type="button"
            onClick={() => setView({ kind: "editor", profile: blankProfile(), isNew: true })}
            aria-label="New profile"
            className="bg-brand/16 text-brand hover:bg-brand/26 focus-visible:ring-brand/60 flex size-8 items-center justify-center rounded-full transition-[background-color,transform] duration-[var(--dur-press)] [transition-timing-function:var(--ease-out)] focus-visible:ring-2 focus-visible:outline-none active:scale-[0.94]"
          >
            <Plus className="size-4" />
          </button>
        </header>

        <ul className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-3 pb-4">
          {store.profiles.map((p) => {
            const isActive = p.id === store.active_id;
            const isRunning = p.id === runningId;
            return (
              <li key={p.id} className="flex items-stretch gap-1.5">
                <button
                  type="button"
                  onClick={() => onSelect(p.id)}
                  aria-current={isActive ? "true" : undefined}
                  className={[
                    "flex min-w-0 flex-1 items-center gap-3 rounded-[var(--radius-card)] px-3 py-2.5 text-left",
                    "transition-[background-color,transform] duration-[var(--dur-press)]",
                    "[transition-timing-function:var(--ease-out)] active:scale-[0.99]",
                    "focus-visible:ring-brand/60 focus-visible:ring-2 focus-visible:outline-none",
                    isActive ? "bg-raised-hover" : "hover:bg-raised",
                  ].join(" ")}
                >
                  <span className="grid size-5 shrink-0 place-items-center">
                    {isRunning ? (
                      <span
                        className="size-2.5 rounded-full"
                        style={{
                          background: "var(--color-st-running)",
                          boxShadow:
                            "0 0 0 4px color-mix(in oklab, var(--color-st-running) 22%, transparent)",
                        }}
                        aria-label="Running"
                      />
                    ) : isActive ? (
                      <Check className="text-brand size-4" aria-label="Active" />
                    ) : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="text-text block truncate text-[14px]">{p.name}</span>
                    <span
                      dir="ltr"
                      className="text-faint tnum block truncate text-left font-mono text-[10.5px]"
                    >
                      {p.LISTEN_HOST}:{p.LISTEN_PORT} &rarr; {p.CONNECT_IP}:{p.CONNECT_PORT}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setView({ kind: "editor", profile: p, isNew: false })}
                  aria-label={`Edit ${p.name}`}
                  className="text-faint hover:bg-raised hover:text-text focus-visible:ring-brand/60 flex w-9 shrink-0 items-center justify-center rounded-[var(--radius-card)] transition-[background-color,color,transform] duration-[var(--dur-press)] [transition-timing-function:var(--ease-out)] focus-visible:ring-2 focus-visible:outline-none active:scale-[0.94]"
                >
                  <MoreHorizontal className="size-4" />
                </button>
              </li>
            );
          })}
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
