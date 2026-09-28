import type { TunnelMode } from "@/types";

/**
 * The three interception modes, what each one does, and what it guarantees.
 *
 * These sentences are the single most consequential copy in the application:
 * a user choosing "System proxy" is choosing a mode that guarantees nothing,
 * and there is no way to learn that from the words "system proxy".
 *
 * Availability is not decided here: Rust reports it per machine, and
 * `modeBlockedReason` carries its sentence.
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
  /** Always `null` now: whether a mode can run is a fact about this
   *  machine, and Rust answers it (`sysproxy_support`, `tun_support`). */
  blocked: null;
}

export const MODES: Record<TunnelMode, ModeInfo> = {
  manual: {
    value: "manual",
    icon: "tune",
    name: "Manual",
    does: "Opens the port and sets nothing. Point your applications at it yourself.",
    guarantee: "None. It intercepts what you target and nothing else.",
    tone: "neutral",
    blocked: null,
  },
  system_proxy: {
    value: "system_proxy",
    icon: "code",
    name: "System proxy",
    does: "Opens the port and sets it as the system proxy, restoring your previous setting when it stops.",
    guarantee: "None. An app that ignores the system proxy goes out direct.",
    tone: "warn",
    blocked: null,
  },
  tun: {
    value: "tun",
    icon: "hub",
    name: "TUN (virtual)",
    does: "Captures all operating-system traffic through a virtual network interface.",
    guarantee:
      "Captures every application. If anything fails, traffic is blocked — never sent around the tunnel.",
    tone: "ok",
    blocked: null,
  },
};

export const MODE_ORDER: TunnelMode[] = ["manual", "system_proxy", "tun"];

/**
 * Why a mode cannot be chosen on this machine, or `null`. Both reasons come
 * from Rust, which is the only side that can look: `gsettings`/`kwriteconfig`
 * for the system proxy, `nft`/`ip` and the platform for TUN.
 */
export function modeBlockedReason(
  mode: TunnelMode,
  blocked: { systemProxy: string | null; tun: string | null },
): string | null {
  if (mode === "system_proxy") return blocked.systemProxy;
  if (mode === "tun") return blocked.tun;
  return null;
}
