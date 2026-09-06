import { describe, expect, it } from "vitest";
import { canStartTunnel, nextTunnelState } from "./tunnelMachine";

describe("canStartTunnel", () => {
  it("allows a start only when the link is up, a core exists and a tunnel is selected", () => {
    expect(canStartTunnel("running", true, true)).toBeNull();
  });

  it("refuses while the link is not running, and says so", () => {
    for (const link of ["stopped", "starting", "error"] as const) {
      const reason = canStartTunnel(link, true, true);
      expect(reason, link).not.toBeNull();
      expect(reason!.toLowerCase()).toContain("link");
    }
  });

  it("refuses without a core, and says so", () => {
    expect(canStartTunnel("running", false, true)!.toLowerCase()).toContain("core");
  });

  it("refuses with no tunnel selected, and says so", () => {
    expect(canStartTunnel("running", true, false)!.toLowerCase()).toContain("tunnel");
  });

  it("reports the link first when several things are wrong", () => {
    // One reason at a time, and the one furthest upstream: fixing the core
    // while the link is down changes nothing the user can see.
    expect(canStartTunnel("stopped", false, false)!.toLowerCase()).toContain("link");
  });
});

describe("nextTunnelState", () => {
  it("drops an active tunnel into holding when the link leaves running", () => {
    expect(nextTunnelState("active", "stopped")).toBe("holding");
    expect(nextTunnelState("active", "error")).toBe("holding");
    expect(nextTunnelState("active", "starting")).toBe("holding");
  });

  it("lifts a holding tunnel back to active when the link returns", () => {
    expect(nextTunnelState("holding", "running")).toBe("active");
  });

  it("leaves an offline tunnel offline whatever the link does", () => {
    expect(nextTunnelState("offline", "running")).toBe("offline");
    expect(nextTunnelState("offline", "stopped")).toBe("offline");
  });

  it("leaves a fault alone until something explicitly clears it", () => {
    expect(nextTunnelState("fault", "running")).toBe("fault");
    expect(nextTunnelState("fault", "stopped")).toBe("fault");
  });

  it("does not put a starting tunnel into holding — starting owns its own outcome", () => {
    expect(nextTunnelState("starting", "stopped")).toBe("starting");
  });
});
