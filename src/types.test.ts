import { describe, expect, it } from "vitest";
import { formatUptime } from "./types";

describe("formatUptime", () => {
  it("pads every field to two digits", () => {
    expect(formatUptime(0)).toBe("00:00:00");
    expect(formatUptime(9_000)).toBe("00:00:09");
    expect(formatUptime(65_000)).toBe("00:01:05");
  });

  it("rolls minutes into hours", () => {
    expect(formatUptime(3_600_000)).toBe("01:00:00");
    expect(formatUptime(8_045_000)).toBe("02:14:05");
  });

  // Hours are deliberately not capped at 24: a proxy left up over a weekend
  // should read 63:xx:xx, not wrap back to 15:xx:xx.
  it("does not wrap past a day", () => {
    expect(formatUptime(90_000_000)).toBe("25:00:00");
  });

  // The clock is driven by two independent Date.now() reads, so a backwards
  // system-clock adjustment can make the difference negative.
  it("clamps a negative duration to zero", () => {
    expect(formatUptime(-5_000)).toBe("00:00:00");
  });
});
