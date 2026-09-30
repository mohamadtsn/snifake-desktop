import type { Routing, TunnelMode } from "@/types";

/**
 * What a routing-mode change actually requires.
 *
 * This is one function rather than a few `if`s at the call site because
 * "when is a restart required" is exactly the logic that loses a branch
 * once it is spread across handlers - and the branch it loses is the one
 * that leaves an OS proxy pointing at a port nothing is listening on.
 */
export interface Transition {
  /** The generated config differs, so the core has to come back up on it. */
  restartTunnel: boolean;
  applyProxy: boolean;
  clearProxy: boolean;
}

/** `Manual` and `SystemProxy` generate the same sing-box inbound; only TUN
 *  is a different shape. See `generate.rs::inbounds`. */
const shape = (mode: TunnelMode): "proxy" | "tun" => (mode === "tun" ? "tun" : "proxy");

export function modeTransition(
  from: TunnelMode,
  to: TunnelMode,
  tunnelRunning: boolean,
): Transition {
  if (from === to) {
    return { restartTunnel: false, applyProxy: false, clearProxy: false };
  }

  // Asked for unconditionally when leaving, even with the tunnel down: the
  // tunnel may have faulted after the proxy was applied, and the marker is
  // what decides whether there is anything to undo.
  const clearProxy = from === "system_proxy";

  return {
    restartTunnel: tunnelRunning && shape(from) !== shape(to),
    // Only when something is listening. Pointing the machine at a dead port
    // is worse than leaving it direct; the tunnel's own start applies it.
    applyProxy: to === "system_proxy" && tunnelRunning,
    clearProxy,
  };
}

/**
 * Whether a save changes what the engine's TUN guard enforces, while it is
 * enforcing it. The engine only reads the kill switch and the coexisting
 * VPNs from a `TunnelStart`; without one the switch would read "on" while
 * nothing is dropped. The restart retargets the guard in place, so the
 * drop never lifts in between.
 */
export function tunGuardChanged(
  from: Routing,
  to: Routing,
  mode: TunnelMode,
  tunnelRunning: boolean,
): boolean {
  return (
    tunnelRunning &&
    mode === "tun" &&
    (from.kill_switch !== to.kill_switch ||
      JSON.stringify(from.passthrough) !== JSON.stringify(to.passthrough))
  );
}
