import { describe, expect, it } from "vitest";
import { project, rubberband, shouldDismiss, velocityFrom } from "./gesture";

describe("velocityFrom", () => {
  it("returns zero for fewer than two samples", () => {
    expect(velocityFrom([])).toBe(0);
    expect(velocityFrom([{ y: 10, t: 0 }])).toBe(0);
  });

  it("measures px per millisecond over the recent window", () => {
    const samples = [
      { y: 0, t: 0 },
      { y: 50, t: 50 },
      { y: 100, t: 100 },
    ];
    expect(velocityFrom(samples)).toBeCloseTo(1, 5);
  });

  it("is negative when the pointer moves up", () => {
    expect(velocityFrom([{ y: 100, t: 0 }, { y: 40, t: 60 }])).toBeCloseTo(-1, 5);
  });

  it("ignores a zero time delta instead of returning Infinity", () => {
    expect(velocityFrom([{ y: 0, t: 10 }, { y: 40, t: 10 }])).toBe(0);
  });
});

describe("project", () => {
  it("projects further the faster the flick", () => {
    expect(project(0)).toBe(0);
    expect(project(2)).toBeGreaterThan(project(1));
  });

  it("matches Apple's exponential decay form", () => {
    // (v * 1000 / 1000) * d / (1 - d) with d = 0.998 -> v * 499
    expect(project(1)).toBeCloseTo(499, 0);
  });
});

describe("rubberband", () => {
  it("returns zero at the boundary", () => {
    expect(rubberband(0, 560)).toBe(0);
  });

  it("resists progressively rather than stopping hard", () => {
    const small = rubberband(20, 560);
    const large = rubberband(200, 560);
    expect(small).toBeLessThan(20);
    expect(large).toBeLessThan(200);
    expect(large).toBeGreaterThan(small);
    // Ten times the pull must not give ten times the travel.
    expect(large).toBeLessThan(small * 10);
  });
});

describe("shouldDismiss", () => {
  const H = 560;

  it("dismisses a short but fast downward flick", () => {
    expect(shouldDismiss(40, 1.2, H)).toBe(true);
  });

  it("keeps a long slow drag that has already stopped", () => {
    expect(shouldDismiss(120, 0, H)).toBe(false);
  });

  it("dismisses a slow drag that passed the halfway point", () => {
    expect(shouldDismiss(300, 0, H)).toBe(true);
  });

  it("never dismisses on an upward flick", () => {
    expect(shouldDismiss(200, -1.5, H)).toBe(false);
  });
});
