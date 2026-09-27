import type { TunnelMode } from "@/types";

/**
 * The three interception modes, what each one does, and what it guarantees.
 *
 * These sentences are the single most consequential copy in the application:
 * a user choosing "System proxy" is choosing a mode that guarantees nothing,
 * and there is no way to learn that from the words "system proxy".
 *
 * `blocked` mirrors `tunnel/generate.rs`'s `inbounds()`, which returns an
 * error for TUN. Duplicated in TypeScript for the same reason `rules.ts` is:
 * the interface has to answer before a round trip, and Rust stays the
 * authority. A mode the generator refuses must not be selectable here, and
 * it must certainly not display a containment guarantee - that would be the
 * interface making its largest claim about the one thing it cannot do.
 */
export interface ModeInfo {
  value: TunnelMode;
  icon: string;
  name: string;
  /** What it captures. */
  does: string;
  /** What it guarantees, in the user's words. */
  guarantee: string;
  tone: "ok" | "warn" | "neutral";
  /** Why it cannot be chosen, or `null` when it can. */
  blocked: string | null;
}

export const MODES: Record<TunnelMode, ModeInfo> = {
  manual: {
    value: "manual",
    icon: "tune",
    name: "Manual",
    does: "Only apps pointed directly at the local port.",
    guarantee: "None. It intercepts what you target and nothing else.",
    tone: "neutral",
    blocked: null,
  },
  system_proxy: {
    value: "system_proxy",
    icon: "code",
    name: "System proxy",
    does: "Apps that read the system proxy setting.",
    guarantee: "None. An app that ignores the system proxy goes out direct.",
    tone: "warn",
    blocked: null,
  },
  tun: {
    value: "tun",
    icon: "hub",
    name: "TUN (virtual)",
    does: "Would capture all operating-system traffic.",
    guarantee: "Not yet available, so it guarantees nothing.",
    tone: "neutral",
    blocked: "TUN arrives in a later phase. Choose System proxy or Manual for now.",
  },
};

export const MODE_ORDER: TunnelMode[] = ["manual", "system_proxy", "tun"];

export function modeBlockedReason(mode: TunnelMode): string | null {
  return MODES[mode].blocked;
}
