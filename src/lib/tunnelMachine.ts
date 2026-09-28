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
 * the words shown on the tunnel's card. One reason at a time, upstream
 * first.
 *
 * A stopped link is deliberately *not* a reason. The tunnel's button
 * starts the link itself (`tunnelStartPlan`), because refusing with "start
 * the other thing first" is the application telling the user to do a job
 * it can do. What remains here are the two blocks only the user can clear.
 */
export function canStartTunnel(coreInstalled: boolean, hasTunnel: boolean): string | null {
  if (!coreInstalled) return "Download the tunnel core first.";
  if (!hasTunnel) return "Add a tunnel configuration first.";
  return null;
}

/** What pressing the tunnel's power button does, given the link. */
export type StartPlan = "tunnel" | "link-then-tunnel" | "await-link";

/**
 * The tunnel dials the link's listener, so a tunnel start with the link
 * down is a link start followed by a tunnel start. A link that is already
 * `starting` is waited for, not started a second time — a second
 * `start_proxy` would restart it and show a second elevation prompt.
 */
export function tunnelStartPlan(link: ProxyState): StartPlan {
  if (link === "running") return "tunnel";
  if (link === "starting") return "await-link";
  return "link-then-tunnel";
}

/** What a pending chained start does when the link reports a new state. */
export type ChainStep = "start-tunnel" | "wait" | "abandon";

/**
 * `stopped` and `error` both abandon: the link is not coming up, whether
 * because it failed or because the user cancelled the password prompt, and
 * a tunnel left in `starting` against a dead link would never resolve.
 */
export function chainStep(link: ProxyState): ChainStep {
  if (link === "running") return "start-tunnel";
  if (link === "starting") return "wait";
  return "abandon";
}

/**
 * What the link's condition does to the tunnel's, and nothing else. The
 * engine owns every other transition; this covers only the coupling
 * between the two stages, which the frontend sees first.
 *
 * `holding` is fail-closed and deliberate: the tunnel's traffic is held —
 * in TUN by a kill switch that outlives the core — rather than coming down
 * and letting everything out around it. `starting` is left alone because it
 * owns its own outcome, and `fault` is left alone because it is a state a
 * person has to clear.
 */
export function nextTunnelState(current: TunnelState, link: ProxyState): TunnelState {
  if (current === "active" && link !== "running") return "holding";
  return current;
}

/**
 * A holding tunnel is resumed by starting it again, not by relabelling it:
 * the engine stopped its core when the link changed, and the new link may
 * listen elsewhere, so the config has to be generated afresh.
 */
export function shouldResumeTunnel(link: ProxyState, tunnel: TunnelState): boolean {
  return link === "running" && tunnel === "holding";
}
