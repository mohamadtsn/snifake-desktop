import { describe, expect, it } from "vitest";
import { DEFAULT_PREFS, loadPrefs, savePrefs, type Prefs } from "@/lib/prefs";

function fakeStorage(seed?: string) {
  let value = seed;
  return {
    getItem: () => value ?? null,
    setItem: (_k: string, v: string) => {
      value = v;
    },
    read: () => value,
  };
}

function throwingStorage() {
  return {
    getItem(): string | null {
      throw new DOMException("denied");
    },
    setItem() {
      throw new DOMException("denied");
    },
  };
}

describe("prefs", () => {
  it("returns the defaults when nothing is stored", () => {
    expect(loadPrefs(fakeStorage())).toEqual(DEFAULT_PREFS);
  });

  it("round-trips a full set", () => {
    const s = fakeStorage();
    const p: Prefs = {
      closeToTray: false,
      colorizeTray: false,
      silentUpdateChecks: false,
      launchAtLogin: true,
      verbose: true,
    };
    savePrefs(p, s);
    expect(loadPrefs(s)).toEqual(p);
  });

  it("keeps the defaults for keys the stored object is missing", () => {
    const s = fakeStorage(JSON.stringify({ closeToTray: false }));
    expect(loadPrefs(s)).toEqual({ ...DEFAULT_PREFS, closeToTray: false });
  });

  it("ignores a stored value of the wrong type", () => {
    const s = fakeStorage(JSON.stringify({ closeToTray: "yes", verbose: 3 }));
    expect(loadPrefs(s)).toEqual(DEFAULT_PREFS);
  });

  it("falls back to the defaults on unparseable JSON", () => {
    expect(loadPrefs(fakeStorage("{not json"))).toEqual(DEFAULT_PREFS);
  });

  it("falls back to the defaults when storage itself throws", () => {
    expect(loadPrefs(throwingStorage())).toEqual(DEFAULT_PREFS);
  });

  it("does not throw when saving into a storage that throws", () => {
    expect(() => savePrefs(DEFAULT_PREFS, throwingStorage())).not.toThrow();
  });

  it("falls back to the defaults when there is no storage at all", () => {
    expect(loadPrefs(null)).toEqual(DEFAULT_PREFS);
    expect(() => savePrefs(DEFAULT_PREFS, null)).not.toThrow();
  });

  it("returns a fresh object each time, so a caller cannot mutate the defaults", () => {
    const first = loadPrefs(fakeStorage());
    first.closeToTray = false;
    expect(DEFAULT_PREFS.closeToTray).toBe(true);
    expect(loadPrefs(fakeStorage()).closeToTray).toBe(true);
  });

  it("ignores a stored array, which parses as an object but is not one", () => {
    expect(loadPrefs(fakeStorage("[true]"))).toEqual(DEFAULT_PREFS);
  });
});
