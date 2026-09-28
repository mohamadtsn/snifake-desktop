import { describe, expect, it } from "vitest";
import { canStartTunnel, chainStep, nextTunnelState, tunnelStartPlan } from "./tunnelMachine";

describe("canStartTunnel", () => {
  it("allows a start when a core exists and a tunnel is selected", () => {
    expect(canStartTunnel(true, true)).toBeNull();
  });

  it("does not treat a stopped link as a block — the button starts it", () => {
    // The link is no longer a reason: `tunnelStartPlan` starts it first.
    // Nothing about the link appears in the signature at all.
    expect(canStartTunnel.length).toBe(2);
  });

  it("refuses without a core, and says so", () => {
    expect(canStartTunnel(false, true)!.toLowerCase()).toContain("core");
  });

  it("refuses with no tunnel selected, and says so", () => {
    expect(canStartTunnel(true, false)!.toLowerCase()).toContain("tunnel");
  });

  it("reports the core first when both are missing", () => {
    // Upstream first: a tunnel cannot be tried without a core to run it.
    expect(canStartTunnel(false, false)!.toLowerCase()).toContain("core");
  });
});

describe("tunnelStartPlan", () => {
  it("starts the tunnel directly when the link is up", () => {
    expect(tunnelStartPlan("running")).toBe("tunnel");
  });

  it("starts the link first when it is down or faulted", () => {
    expect(tunnelStartPlan("stopped")).toBe("link-then-tunnel");
    expect(tunnelStartPlan("error")).toBe("link-then-tunnel");
  });

  it("waits for a link that is already coming up rather than starting it twice", () => {
    expect(tunnelStartPlan("starting")).toBe("await-link");
  });
});

describe("chainStep", () => {
  it("starts the tunnel the moment the link reports running", () => {
    expect(chainStep("running")).toBe("start-tunnel");
  });

  it("keeps waiting while the link is starting", () => {
    expect(chainStep("starting")).toBe("wait");
  });

  it("abandons when the link stops or faults — a cancelled prompt lands here", () => {
    expect(chainStep("stopped")).toBe("abandon");
    expect(chainStep("error")).toBe("abandon");
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
