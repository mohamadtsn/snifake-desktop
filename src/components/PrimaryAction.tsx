import { ProxyState } from "@/types";

/**
 * One button, not two. The old UI showed Start and Stop side by side with one
 * of them always greyed out, which reads as "half this UI is broken". The
 * button morphs instead: its label and colour follow the state.
 */
export function PrimaryAction({
  state,
  onStart,
  onStop,
}: {
  state: ProxyState;
  onStart: () => void;
  onStop: () => void;
}) {
  const active = state === "running" || state === "starting";

  return (
    <button
      onClick={active ? onStop : onStart}
      className={[
        "h-[46px] w-full rounded-[var(--radius-control)] text-[15px] font-semibold",
        // Press feedback is on :active, not on click — the interface has to
        // answer the finger, not the release.
        "transition-[background-color,transform,box-shadow] duration-150",
        "[transition-timing-function:var(--ease-out-quint)]",
        "active:scale-[0.985] focus-visible:outline-none",
        "focus-visible:ring-2 focus-visible:ring-brand/60 focus-visible:ring-offset-2",
        "focus-visible:ring-offset-shell",
        active
          ? "bg-st-error/15 text-st-error shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--color-st-error)_38%,transparent)] hover:bg-st-error/22"
          : "bg-brand text-white shadow-[0_6px_20px_-6px_var(--color-brand)] hover:bg-brand/90",
      ].join(" ")}
    >
      {active ? "Stop" : "Start"}
    </button>
  );
}
