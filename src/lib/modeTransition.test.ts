import { describe, expect, it } from "vitest";
import { modeTransition, tunGuardChanged } from "@/lib/modeTransition";
import type { Routing } from "@/types";

describe("modeTransition", () => {
  it("does nothing when the mode did not change", () => {
    expect(modeTransition("system_proxy", "system_proxy", true)).toEqual({
      restartTunnel: false,
      applyProxy: false,
      clearProxy: false,
    });
  });

  it("sets the proxy when moving to system proxy with the tunnel already up", () => {
    expect(modeTransition("manual", "system_proxy", true)).toEqual({
      restartTunnel: false,
      applyProxy: true,
      clearProxy: false,
    });
  });

  it("does not restart the core between the two proxy modes", () => {
    // `inbounds()` produces a byte-identical config for both. Restarting
    // would be a gratuitous outage for a change the core cannot even see.
    expect(modeTransition("system_proxy", "manual", true).restartTunnel).toBe(false);
    expect(modeTransition("manual", "system_proxy", true).restartTunnel).toBe(false);
  });

  it("clears the proxy when leaving system proxy", () => {
    expect(modeTransition("system_proxy", "manual", true)).toEqual({
      restartTunnel: false,
      applyProxy: false,
      clearProxy: true,
    });
  });

  it("restarts when the inbound shape changes", () => {
    expect(modeTransition("manual", "tun", true).restartTunnel).toBe(true);
    expect(modeTransition("tun", "manual", true).restartTunnel).toBe(true);
  });

  it("asks for nothing at all while the tunnel is down", () => {
    // Nothing is listening, so setting a proxy would point the machine at a
    // dead port. It gets applied when the tunnel starts instead.
    expect(modeTransition("manual", "system_proxy", false)).toEqual({
      restartTunnel: false,
      applyProxy: false,
      clearProxy: false,
    });
  });

  it("still clears when leaving system proxy with the tunnel already down", () => {
    // The tunnel may have faulted after the proxy was applied. The marker
    // is what decides whether there is anything to undo; asking is free.
    expect(modeTransition("system_proxy", "manual", false).clearProxy).toBe(true);
  });

  it("treats a tunnel that is only starting as not running", () => {
    // Applying a proxy for a tunnel that then fails to start would leave the
    // machine pointed at a port that never opened. `tunnelRunning` is passed
    // `state === "active"`, never `"starting"`.
    expect(modeTransition("manual", "system_proxy", false).applyProxy).toBe(false);
  });
});

describe("tunGuardChanged", () => {
  const base = {
    block: [], bypass: [], proxy: [], raw: null, default_route: "proxy", block_quic: true,
    allow_lan: true, kill_switch: true, passthrough: [], rule_sets: [],
  } as Routing;

  it("restarts a running TUN when the kill switch or the coexisting VPNs change", () => {
    expect(tunGuardChanged(base, { ...base, kill_switch: false }, "tun", true)).toBe(true);
    expect(tunGuardChanged(base, { ...base, passthrough: ["wg0"] }, "tun", true)).toBe(true);
  });

  it("leaves everything else alone", () => {
    expect(tunGuardChanged(base, { ...base, kill_switch: false }, "tun", false)).toBe(false);
    expect(tunGuardChanged(base, { ...base, kill_switch: false }, "system_proxy", true)).toBe(false);
    expect(tunGuardChanged(base, { ...base, block: ["x.com"] }, "tun", true)).toBe(false);
  });
});
