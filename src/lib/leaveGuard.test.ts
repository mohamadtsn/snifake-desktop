import { describe, expect, it } from "vitest";
import {
  clearDraft,
  LEAVE_COPY,
  leaveDecision,
  QUIT_COPY,
  type DraftOwner,
  type DraftReport,
} from "@/lib/leaveGuard";

const report = (over: Partial<DraftReport> = {}): DraftReport => ({
  owner: "sockets",
  dirty: true,
  invalid: null,
  save: async () => {},
  ...over,
});

const OWNERS: DraftOwner[] = ["sockets", "sni-editor", "tunnel-editor"];

describe("leaveDecision", () => {
  it("goes straight through when nothing has reported a draft", () => {
    expect(leaveDecision(null, false)).toEqual({ kind: "go" });
  });

  it("goes straight through when the draft is clean", () => {
    expect(leaveDecision(report({ dirty: false }), false)).toEqual({ kind: "go" });
  });

  it("asks before leaving a dirty draft, for every owner", () => {
    for (const owner of OWNERS) {
      expect(leaveDecision(report({ owner }), false), owner).toEqual({
        kind: "confirm",
        owner,
        saveBlocked: null,
      });
    }
  });

  it("does not ask when the destination is where the user already is", () => {
    // Pressing the current tab, or re-selecting the selected profile, is
    // not leaving. Asking would be a dialog about a change not happening.
    expect(leaveDecision(report(), true)).toEqual({ kind: "go" });
  });

  it("carries the draft's own reason when it cannot be saved", () => {
    // Save and leave must be refused with a reason, never attempted.
    expect(leaveDecision(report({ invalid: "A port between 1 and 65535." }), false)).toEqual({
      kind: "confirm",
      owner: "sockets",
      saveBlocked: "A port between 1 and 65535.",
    });
  });
});

describe("clearDraft", () => {
  it("clears the owner's own report on unmount", () => {
    expect(clearDraft(report({ owner: "sni-editor" }), "sni-editor")).toBeNull();
  });

  it("leaves another owner's report alone", () => {
    // Switching SNI links -> Tunnels unmounts one editor and mounts the
    // other in one commit. The outgoing cleanup must not erase the report
    // the incoming editor has just made.
    const incoming = report({ owner: "tunnel-editor" });
    expect(clearDraft(incoming, "sni-editor")).toBe(incoming);
  });

  it("is a no-op with nothing reported", () => {
    expect(clearDraft(null, "sockets")).toBeNull();
  });
});

describe("copy", () => {
  it("names what is unsaved, for every owner, in both dialogs", () => {
    for (const owner of OWNERS) {
      expect(LEAVE_COPY[owner].length, owner).toBeGreaterThan(0);
      expect(QUIT_COPY[owner].length, owner).toBeGreaterThan(0);
    }
  });
});
