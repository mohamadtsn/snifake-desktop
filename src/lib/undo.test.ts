import { afterEach, describe, expect, it, vi } from "vitest";
import { undoIntent, useUndoHistory } from "./undo";

/**
 * `useUndoHistory` keeps everything in refs and never reads render state, so
 * it can be exercised directly with a stub `useRef`. That is the point of
 * writing it that way: the behaviour that decides how editing feels is
 * testable without a DOM.
 */
vi.mock("react", () => ({
  useRef: <T>(initial: T) => ({ current: initial }),
}));

afterEach(() => vi.useRealTimers());

describe("useUndoHistory", () => {
  it("restores the value from before a burst of typing", () => {
    const h = useUndoHistory("cloudflare");
    for (const v of ["h", "he", "hel", "hell", "hello"]) h.record(v);
    // One step, not five: the burst is a single edit.
    expect(h.undo()).toBe("cloudflare");
    expect(h.undo()).toBeUndefined();
  });

  it("keeps bursts separated by a pause as separate steps", () => {
    vi.useFakeTimers();
    const h = useUndoHistory("a");
    h.record("ab");
    vi.advanceTimersByTime(900);
    h.record("abc");
    expect(h.undo()).toBe("ab");
    expect(h.undo()).toBe("a");
  });

  it("redoes what it undid", () => {
    const h = useUndoHistory("one");
    h.record("two");
    expect(h.undo()).toBe("one");
    expect(h.redo()).toBe("two");
    expect(h.redo()).toBeUndefined();
  });

  // The rule every text editor uses: branching discards the forward history.
  it("drops the redo branch once a new edit lands", () => {
    const h = useUndoHistory("one");
    h.record("two");
    h.undo();
    h.record("three");
    expect(h.redo()).toBeUndefined();
    expect(h.undo()).toBe("one");
  });

  it("does not merge the keystroke after an undo into the undone burst", () => {
    const h = useUndoHistory("a");
    h.record("ab");
    h.undo();
    h.record("ax");
    expect(h.undo()).toBe("a");
  });
});

describe("undoIntent", () => {
  const key = (over: Partial<Parameters<typeof undoIntent>[0]>) =>
    undoIntent({ key: "z", ctrlKey: false, metaKey: false, shiftKey: false, ...over });

  it("reads undo and both redo conventions", () => {
    expect(key({ ctrlKey: true })).toBe("undo");
    expect(key({ metaKey: true })).toBe("undo");
    expect(key({ ctrlKey: true, shiftKey: true })).toBe("redo");
    expect(key({ metaKey: true, shiftKey: true })).toBe("redo");
    expect(key({ key: "y", ctrlKey: true })).toBe("redo");
  });

  it("ignores anything that is not the shortcut", () => {
    expect(key({})).toBeNull();
    expect(key({ key: "a", ctrlKey: true })).toBeNull();
    expect(key({ shiftKey: true })).toBeNull();
  });

  // Keyboard layouts and caps lock both deliver "Z".
  it("is case-insensitive", () => {
    expect(key({ key: "Z", ctrlKey: true })).toBe("undo");
    expect(key({ key: "Y", ctrlKey: true })).toBe("redo");
  });
});
