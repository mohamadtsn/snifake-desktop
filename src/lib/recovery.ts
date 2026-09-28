import type { TunnelState } from "@/types";

/**
 * Whether Telemetry shows "Network is still blocked from the last session."
 *
 * `leftover` is `tun_leftover_status()`: a TUN session ended without the
 * engine reporting its kill switch down. Only while the tunnel is `offline`:
 * in any other state the tunnel's own card is already saying what is
 * happening, and a second voice would contradict it.
 */
export function showRecovery(leftover: boolean, tunnel: TunnelState): boolean {
  return leftover && tunnel === "offline";
}
