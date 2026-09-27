import { describe, expect, it } from "vitest";
import { formatRate, formatTotal, rateBetween } from "@/lib/traffic";

describe("rateBetween", () => {
  it("has no rate from a single sample", () => {
    // One cumulative reading says how much has moved in total, not how
    // fast. Reporting the total as a rate would be a fabricated number.
    expect(rateBetween(null, { up: 1000, down: 2000, at: 5000 })).toEqual({
      up: null,
      down: null,
    });
  });

  it("divides the difference by the elapsed wall clock", () => {
    const a = { up: 1000, down: 2000, at: 1000 };
    const b = { up: 3000, down: 10000, at: 3000 };
    expect(rateBetween(a, b)).toEqual({ up: 1000, down: 4000 });
  });

  it("reports nothing when the counters went backwards", () => {
    // The stage restarted, so its counters reset. The difference is
    // negative; a naive subtraction would draw a negative meter.
    const a = { up: 9_000_000, down: 9_000_000, at: 1000 };
    const b = { up: 12, down: 12, at: 2000 };
    expect(rateBetween(a, b)).toEqual({ up: null, down: null });
  });

  it("reports nothing when no time has passed", () => {
    // Two samples inside the same millisecond. Dividing would be by zero.
    const a = { up: 1000, down: 1000, at: 4242 };
    const b = { up: 2000, down: 2000, at: 4242 };
    expect(rateBetween(a, b)).toEqual({ up: null, down: null });
  });

  it("reports a real zero when nothing moved between two samples", () => {
    // Distinct from `null`: we measured, and the answer was nothing.
    const a = { up: 1000, down: 1000, at: 1000 };
    const b = { up: 1000, down: 1000, at: 2000 };
    expect(rateBetween(a, b)).toEqual({ up: 0, down: 0 });
  });
});

describe("formatRate", () => {
  it("says a dash when there is no reading", () => {
    // Not "0 B/s". Zero is a claim that nothing moved; a dash is the
    // absence of a measurement. DESIGN.md 4.1.
    expect(formatRate(null)).toBe("—");
  });

  it("scales to the unit that keeps the number short", () => {
    expect(formatRate(0)).toBe("0 B/s");
    expect(formatRate(512)).toBe("512 B/s");
    expect(formatRate(2048)).toBe("2.0 KB/s");
    expect(formatRate(5_242_880)).toBe("5.0 MB/s");
  });
});

describe("formatTotal", () => {
  it("says a dash when there is no reading", () => {
    expect(formatTotal(null)).toBe("—");
  });

  it("scales the same way, without the rate suffix", () => {
    expect(formatTotal(0)).toBe("0 B");
    expect(formatTotal(1_267_650)).toBe("1.2 MB");
    expect(formatTotal(1_610_612_736)).toBe("1.5 GB");
  });
});
