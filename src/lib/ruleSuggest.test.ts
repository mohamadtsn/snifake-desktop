import { describe, expect, it } from "vitest";
import { PREFIX_HELP, applySuggestion, suggest } from "./ruleSuggest";

describe("suggest", () => {
  it("offers nothing on an empty line (the guide covers discovery)", () => {
    expect(suggest("", ["x"])).toEqual([]);
  });
  it("completes a prefix", () => {
    expect(suggest("do", []).map((s) => s.insert)).toEqual(["domain:"]);
    expect(suggest("p", []).map((s) => s.insert)).toEqual(["port:", "process:", "path:"]);
  });
  it("offers rule set tags after ruleset:", () => {
    expect(suggest("ruleset:geo", ["geoip-ir", "geosite-ir", "mine"]).map((s) => s.insert))
      .toEqual(["ruleset:geoip-ir", "ruleset:geosite-ir"]);
  });
  it("offers tcp and udp after network:", () => {
    expect(suggest("network:", []).map((s) => s.label)).toEqual(["tcp", "udp"]);
  });
  it("stops once the value is complete or the line is a plain value", () => {
    expect(suggest("network:tcp", [])).toEqual([]);
    expect(suggest("example.com", [])).toEqual([]);
  });
  it("covers every prefix the grammar knows", () => {
    expect(PREFIX_HELP.map((p) => p.prefix).sort()).toEqual(
      ["domain", "ip", "keyword", "network", "path", "port", "process", "regex", "ruleset", "suffix"],
    );
  });
});

describe("applySuggestion", () => {
  it("replaces the current line up to the caret", () => {
    expect(applySuggestion("a.com\ndo", 8, "domain:")).toEqual({ text: "a.com\ndomain:", caret: 13 });
  });
  it("keeps what follows the caret", () => {
    expect(applySuggestion("rul\nb.com", 3, "ruleset:")).toEqual({ text: "ruleset:\nb.com", caret: 8 });
  });
});
