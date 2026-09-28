import { describe, expect, it } from "vitest";
import { MODES, modeBlockedReason } from "@/lib/modes";
import type { TunnelMode } from "@/types";

describe("interception modes", () => {
  const none = { systemProxy: null, tun: null };

  it("offers TUN wherever the platform supports it", () => {
    expect(modeBlockedReason("tun", none)).toBeNull();
  });

  it("carries the platform's own sentence when it does not", () => {
    const why = "Install the nftables package to use TUN.";
    expect(modeBlockedReason("tun", { systemProxy: null, tun: why })).toBe(why);
    expect(modeBlockedReason("system_proxy", { systemProxy: "no gsettings", tun: null })).toBe("no gsettings");
  });

  it("never blocks manual", () => {
    expect(modeBlockedReason("manual", { systemProxy: "x", tun: "y" })).toBeNull();
  });

  it("gives TUN the one guarantee that is a containment claim", () => {
    expect(MODES.tun.guarantee).toBe(
      "Captures every application. If anything fails, traffic is blocked — never sent around the tunnel.",
    );
    expect(MODES.tun.tone).toBe("ok");
  });

  it("reports the two modes the generator implements as available", () => {
    expect(modeBlockedReason("manual", none)).toBeNull();
    expect(modeBlockedReason("system_proxy", none)).toBeNull();
  });

  it("gives every mode a name and a guarantee", () => {
    for (const mode of Object.keys(MODES) as TunnelMode[]) {
      expect(MODES[mode].name.length).toBeGreaterThan(0);
      expect(MODES[mode].guarantee.length).toBeGreaterThan(0);
      expect(MODES[mode].does.length).toBeGreaterThan(0);
    }
  });

  it("says plainly that neither available mode guarantees anything", () => {
    expect(MODES.manual.guarantee).toMatch(/none/i);
    expect(MODES.system_proxy.guarantee).toMatch(/none/i);
  });

  it("says that system proxy actually sets the OS setting", () => {
    // It did not, for the whole of the previous release: `inbounds()`
    // produced the same config as Manual and nothing was ever written.
    expect(MODES.system_proxy.does).toMatch(/sets it as the system proxy/i);
  });

  it("still refuses to promise that anything honours it", () => {
    // Setting the OS proxy compels nothing. That is the fact the card has
    // always been for, and making the mode work does not change it. The
    // copy says "None."; the pattern accepts either word, because this
    // pins the promise, not the wording.
    expect(MODES.system_proxy.guarantee).toMatch(/none|nothing/i);
  });

  it("says that manual sets nothing", () => {
    expect(MODES.manual.does).toMatch(/nothing/i);
  });
});
