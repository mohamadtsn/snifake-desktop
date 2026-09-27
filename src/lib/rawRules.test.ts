import { describe, expect, it } from "vitest";
import { parseRawRules } from "@/lib/rawRules";

describe("parseRawRules", () => {
  it("treats an empty box as no raw rules at all", () => {
    expect(parseRawRules("")).toEqual({ value: null, error: null });
    expect(parseRawRules("   \n ")).toEqual({ value: null, error: null });
  });

  // `generate.rs` does `raw.as_array()?` and extends the rules list with its
  // elements. An array of rule objects is the only shape it accepts.
  it("accepts an array of rule objects, which is what the generator extends", () => {
    const got = parseRawRules('[{ "domain": ["x.example"], "outbound": "direct" }]');
    expect(got.error).toBeNull();
    expect(got.value).toEqual([{ domain: ["x.example"], outbound: "direct" }]);
  });

  it("accepts an empty array", () => {
    expect(parseRawRules("[]")).toEqual({ value: [], error: null });
  });

  it("rejects a bare object, which the generator refuses outright", () => {
    const got = parseRawRules('{ "final": "proxy" }');
    expect(got.value).toBeNull();
    expect(got.error).toMatch(/array/i);
  });

  it("rejects an array whose elements are not objects", () => {
    const got = parseRawRules('["domain:example.com"]');
    expect(got.value).toBeNull();
    expect(got.error).toMatch(/object/i);
  });

  it("reports unparseable JSON rather than throwing", () => {
    const got = parseRawRules("[{");
    expect(got.value).toBeNull();
    expect(got.error).toBeTruthy();
  });

  it("rejects a scalar", () => {
    expect(parseRawRules("42").error).toMatch(/array/i);
    expect(parseRawRules('"x"').error).toMatch(/array/i);
    expect(parseRawRules("null").error).toMatch(/array/i);
  });
});
