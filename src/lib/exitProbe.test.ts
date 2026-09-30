import { describe, expect, it } from "vitest";
import { PROBE_DELAYS, nextDelay, reduce } from "./exitProbe";

describe("exit probe schedule", () => {
  it("waits for the tunnel to settle, then backs off, then gives up", () => {
    expect(nextDelay(0)).toBe(PROBE_DELAYS[0]);
    expect(nextDelay(3)).toBe(16000);
    expect(nextDelay(4)).toBeNull();
  });

  it("a_new_run_forgets_the_previous_exit", () => {
    const ok = { status: "ok" as const, info: { ip: "1.1.1.1", city: "", region: "", country: "DE", org: "" } };
    expect(reduce(ok, { type: "run" })).toEqual({ status: "checking" });
  });

  it("a refresh failure keeps the last good reading", () => {
    const ok = { status: "ok" as const, info: { ip: "1.1.1.1", city: "", region: "", country: "DE", org: "" } };
    expect(reduce(ok, { type: "failed", reason: "x", final: true })).toBe(ok);
  });

  it("gives up in words after the last attempt", () => {
    expect(reduce({ status: "checking" }, { type: "failed", reason: "timeout", final: true }))
      .toEqual({ status: "failed", reason: "timeout" });
    expect(reduce({ status: "checking" }, { type: "failed", reason: "timeout", final: false }))
      .toEqual({ status: "checking" });
  });
});
