import { ChevronRight } from "lucide-react";
import { Profile, ProxyState, STATE_COLOR } from "@/types";

/**
 * Which profile the disc will act on, and the way into managing them. A
 * separate control from the disc on purpose: switching profiles and
 * starting the proxy are different decisions and must not share a hit area.
 */
export function ProfileBar({
  profile,
  state,
  onOpen,
}: {
  profile: Profile;
  state: ProxyState;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="raised group hover:bg-raised-hover focus-visible:ring-brand/60 flex h-12 w-full shrink-0 items-center gap-3 px-3.5 text-left transition-[background-color,transform] duration-[var(--dur-press)] [transition-timing-function:var(--ease-out)] focus-visible:ring-2 focus-visible:outline-none active:scale-[0.99]"
    >
      <span
        className="size-2 shrink-0 rounded-full"
        style={{ background: STATE_COLOR[state] }}
        aria-hidden
      />
      <span className="min-w-0 flex-1">
        <span
          className="text-text block truncate text-[14px] font-medium"
          style={{ letterSpacing: "var(--track-body)" }}
        >
          {profile.name}
        </span>
      </span>
      <span className="text-faint text-[11.5px]">Profiles</span>
      <ChevronRight className="text-faint size-4 shrink-0 transition-transform duration-[var(--dur-fast)] [transition-timing-function:var(--ease-out)] group-hover:translate-x-0.5" />
    </button>
  );
}
