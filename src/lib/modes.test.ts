import { describe, expect, it } from "vitest";
import { MODES, modeBlockedReason } from "@/lib/modes";
import type { TunnelMode } from "@/types";

describe("interception modes", () => {
  // `generate.rs`'s `inbounds()` returns Err for TunnelMode::Tun:
  // "TUN mode arrives in a later phase. Choose System Proxy or Manual for
  // now." Offering it as selectable means the user reads a guarantee about
  // failing closed and then cannot start the tunnel at all.
  it("reports TUN as not yet available", () => {
    const reason = modeBlockedReason("tun");
    expect(reason).toBeTruthy();
    expect(reason).toMatch(/later phase/i);
  });

  it("reports the two modes the generator implements as available", () => {
    expect(modeBlockedReason("manual")).toBeNull();
    expect(modeBlockedReason("system_proxy")).toBeNull();
  });

  it("gives every mode a name and a guarantee", () => {
    for (const mode of Object.keys(MODES) as TunnelMode[]) {
      expect(MODES[mode].name.length).toBeGreaterThan(0);
      expect(MODES[mode].guarantee.length).toBeGreaterThan(0);
      expect(MODES[mode].does.length).toBeGreaterThan(0);
    }
  });

  // The guarantee is the most consequential sentence in the application.
  // A mode that cannot run must not claim one.
  it("does not let an unavailable mode claim a containment guarantee", () => {
    expect(MODES.tun.tone).not.toBe("ok");
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
