import { describe, expect, it } from "vitest";
import { leaveDecision } from "@/lib/leaveGuard";

describe("leaveDecision", () => {
  it("goes straight through when nothing is unsaved", () => {
    expect(leaveDecision(false, "sockets", "config")).toEqual({ kind: "go" });
  });

  it("asks before leaving a dirty tab", () => {
    expect(leaveDecision(true, "sockets", "config")).toEqual({ kind: "confirm", to: "config" });
  });

  it("does not ask when the destination is the tab already shown", () => {
    // Clicking the current tab is not leaving it. Asking would be a dialog
    // for a change that is not happening.
    expect(leaveDecision(true, "sockets", "sockets")).toEqual({ kind: "go" });
  });

  it("only guards the tab that owns the draft", () => {
    // Nothing else in the window holds unsaved state, so a dirty flag left
    // set by a stale render must not trap the user on About.
    expect(leaveDecision(true, "about", "config")).toEqual({ kind: "go" });
  });
});
