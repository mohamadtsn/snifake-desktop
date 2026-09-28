import { describe, expect, it } from "vitest";
import { showRecovery } from "./recovery";

describe("showRecovery", () => {
  it("shows when a previous session left the kill switch and nothing is running now", () => {
    expect(showRecovery(true, "offline")).toBe(true);
  });

  it("hides once the tunnel is doing something — its own card speaks then", () => {
    for (const s of ["starting", "active", "holding", "fault"] as const) {
      expect(showRecovery(true, s)).toBe(false);
    }
  });

  it("never shows without a marker", () => {
    expect(showRecovery(false, "offline")).toBe(false);
  });
});
