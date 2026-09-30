import { describe, expect, it } from "vitest";
import { formatFromName, ruleSetDefError } from "./ruleSets";

describe("rule set definitions", () => {
  it("infers the format from the extension", () => {
    expect(formatFromName("https://x/geoip-ir.srs")).toBe("binary");
    expect(formatFromName("list.JSON")).toBe("source");
    expect(formatFromName("https://x/no-extension")).toBe("binary");
  });
  it("refuses a bad tag, a duplicate and a non-http URL", () => {
    const existing = [{ tag: "a", format: "binary" as const, source: { type: "local" as const, path: "/x" } }];
    expect(ruleSetDefError("bad tag", "https://x", [])).not.toBeNull();
    expect(ruleSetDefError("a", "https://x", existing)).toMatch(/already/);
    expect(ruleSetDefError("b", "ftp://x", [])).toMatch(/http/);
    expect(ruleSetDefError("b", "https://x/b.srs", existing)).toBeNull();
    expect(ruleSetDefError("b", null, existing)).toBeNull();
  });
});
