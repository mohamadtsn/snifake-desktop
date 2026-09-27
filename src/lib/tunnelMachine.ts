/**
 * The two-stage dependency, as data rather than as scattered conditions.
 *
 * The tunnel's outbound dials the SNI listener, so every rule here comes
 * from one fact: stage two is worthless without stage one. Keeping it in
 * a pure module means the reason a switch is disabled is testable, and
 * means the switch and the tooltip can never disagree about it.
 */

import type { ProxyState, TunnelState } from "@/types";

/**
 * `null` means a start is allowed; a string is the reason it is not, in
 * the words shown under the disabled switch. One reason at a time, and
 * always the one furthest upstream: telling someone to install a core
 * while the link is down sends them to fix the wrong thing.
 */
export function canStartTunnel(
  link: ProxyState,
  coreInstalled: boolean,
  hasTunnel: boolean,
): string | null {
  if (link !== "running") return "Start the SNI link first. The tunnel connects through it.";
  if (!coreInstalled) return "Download the tunnel core first.";
  if (!hasTunnel) return "Add a tunnel configuration first.";
  return null;
}

/**
 * What the link's condition does to the tunnel's, and nothing else. The
 * engine owns every other transition; this covers only the coupling
 * between the two stages, which the frontend sees first.
 *
 * `holding` is fail-closed and deliberate: the tunnel stays up with its
 * traffic held rather than coming down and letting everything out around
 * it. `starting` is left alone because it owns its own outcome, and
 * `fault` is left alone because it is a state a person has to clear.
 */
export function nextTunnelState(current: TunnelState, link: ProxyState): TunnelState {
  if (current === "active" && link !== "running") return "holding";
  if (current === "holding" && link === "running") return "active";
  return current;
}
