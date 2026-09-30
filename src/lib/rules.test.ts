import { describe, expect, it } from "vitest";
import fixtureTable from "./rules.fixtures.json";
import { parseRuleLine, validateRuleList } from "./rules";

describe("parseRuleLine", () => {
  it("infers a bare domain as a suffix", () => {
    expect(parseRuleLine("example.com")).toEqual({ ok: true, kind: "domain_suffix" });
  });

  it("infers a bare CIDR or address as an IP rule", () => {
    expect(parseRuleLine("10.0.0.0/8")).toEqual({ ok: true, kind: "ip_cidr" });
    expect(parseRuleLine("1.1.1.1")).toEqual({ ok: true, kind: "ip_cidr" });
  });

  it("infers a bare number as a port", () => {
    expect(parseRuleLine("443")).toEqual({ ok: true, kind: "port" });
  });

  it("accepts every documented prefix", () => {
    const cases: [string, string][] = [
      ["domain:example.com", "domain"],
      ["suffix:example.com", "domain_suffix"],
      ["keyword:google", "domain_keyword"],
      ["regex:^ads\\..*", "domain_regex"],
      ["ip:10.0.0.0/8", "ip_cidr"],
      ["port:8080", "port"],
      ["process:Telegram", "process_name"],
      ["path:/usr/bin/curl", "process_path"],
      ["ruleset:geosite-ir", "rule_set"],
      ["network:udp", "network"],
    ];
    for (const [line, kind] of cases) {
      expect(parseRuleLine(line), line).toEqual({ ok: true, kind });
    }
  });

  it("treats a blank or commented line as nothing, not as an error", () => {
    expect(parseRuleLine("")).toEqual({ ok: true, kind: null });
    expect(parseRuleLine("   ")).toEqual({ ok: true, kind: null });
    expect(parseRuleLine("# a note")).toEqual({ ok: true, kind: null });
  });

  it("names an unknown prefix in the error", () => {
    const got = parseRuleLine("banana:x");
    expect(got.ok).toBe(false);
    expect(got.ok === false && got.error).toContain("banana");
  });

  it("rejects a prefix with no value", () => {
    expect(parseRuleLine("domain:").ok).toBe(false);
  });

  it("rejects a port outside 1-65535", () => {
    expect(parseRuleLine("port:0").ok).toBe(false);
    expect(parseRuleLine("port:70000").ok).toBe(false);
  });

  it("rejects a malformed CIDR", () => {
    expect(parseRuleLine("ip:10.0.0.0/99").ok).toBe(false);
    expect(parseRuleLine("ip:not-an-ip").ok).toBe(false);
  });

  it("rejects an invalid regular expression", () => {
    expect(parseRuleLine("regex:[unclosed").ok).toBe(false);
  });

  it("rejects a network other than tcp or udp", () => {
    expect(parseRuleLine("network:sctp").ok).toBe(false);
    expect(parseRuleLine("network:tcp").ok).toBe(true);
  });

  it("accepts any well-formed rule set tag; whether it resolves is checked at save", () => {
    expect(parseRuleLine("ruleset:my-own-set").ok).toBe(true);
    expect(parseRuleLine("ruleset:geoip-ir").ok).toBe(true);
    expect(parseRuleLine("ruleset:bad tag").ok).toBe(false);
  });
});

describe("validateRuleList", () => {
  it("returns one slot per line, null where the line is fine", () => {
    const got = validateRuleList(["example.com", "banana:x", "", "port:0"]);
    expect(got).toHaveLength(4);
    expect(got[0]).toBeNull();
    expect(got[1]).toContain("banana");
    expect(got[2]).toBeNull();
    expect(got[3]).not.toBeNull();
  });
});

/**
 * The parity table. Every case here is checked against this grammar *and*,
 * by an identically-named test in `src-tauri/src/tunnel/rules.rs`, against
 * the Rust one. The two implementations exist on purpose — the editor needs
 * a verdict per keystroke, the core needs one at save — and this file is
 * the only thing standing between "deliberate duplication" and "two
 * grammars that quietly disagree".
 *
 * A line the editor accepts and Rust rejects is a save that fails for no
 * visible reason. A line Rust accepts and the editor underlines is a rule
 * the user deletes because we told them it was wrong.
 */
describe("the shared fixture table", () => {
  const fixtures = fixtureTable as { cases: { line: string; kind: string | null }[] };

  it("is not empty, so a broken import cannot pass as agreement", () => {
    expect(fixtures.cases.length).toBeGreaterThan(20);
  });

  for (const { line, kind } of fixtures.cases) {
    it(`agrees on ${JSON.stringify(line)}`, () => {
      const got = parseRuleLine(line);
      if (kind === null) {
        expect(got.ok).toBe(false);
      } else if (kind === "none") {
        expect(got).toEqual({ ok: true, kind: null });
      } else {
        expect(got).toEqual({ ok: true, kind });
      }
    });
  }
});
