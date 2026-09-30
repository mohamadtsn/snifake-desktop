/**
 * The same rule line grammar as `src-tauri/src/tunnel/rules.rs`.
 *
 * It is duplicated on purpose. The editor has to underline a bad line
 * while it is being typed, and a round trip to Rust for every keystroke
 * would be both slow and, under WebKitGTK, jittery. The Rust side stays
 * the authority: it re-validates on save and again at generation, so a
 * drift between the two shows up as a rejected save, never as a bad
 * config reaching the core. The fixture table in `rules.test.ts` is
 * deliberately the same table as the Rust tests use.
 */

export type RuleKind =
  | "domain"
  | "domain_suffix"
  | "domain_keyword"
  | "domain_regex"
  | "ip_cidr"
  | "port"
  | "process_name"
  | "process_path"
  | "rule_set"
  | "network";

export type ParsedRule =
  | { ok: true; kind: RuleKind | null }
  | { ok: false; error: string };

const PREFIXES: Record<string, RuleKind> = {
  domain: "domain",
  suffix: "domain_suffix",
  keyword: "domain_keyword",
  regex: "domain_regex",
  ip: "ip_cidr",
  port: "port",
  process: "process_name",
  path: "process_path",
  ruleset: "rule_set",
  network: "network",
};

const PREFIX_LIST = Object.keys(PREFIXES).join(", ");

export function parseRuleLine(raw: string): ParsedRule {
  const line = raw.trim();
  if (line === "" || line.startsWith("#")) return { ok: true, kind: null };

  const colon = line.indexOf(":");
  let kind: RuleKind;
  let value: string;

  if (colon > 0 && PREFIXES[line.slice(0, colon)]) {
    kind = PREFIXES[line.slice(0, colon)];
    value = line.slice(colon + 1).trim();
    if (value === "") return { ok: false, error: "This rule has a prefix but no value." };
  } else if (colon > 0 && /^[a-z]+$/i.test(line.slice(0, colon)) && !line.includes("/")) {
    return {
      ok: false,
      error: `Unknown rule prefix "${line.slice(0, colon)}". Use one of: ${PREFIX_LIST}.`,
    };
  } else {
    kind = infer(line);
    value = line;
  }

  const error = validate(kind, value);
  return error ? { ok: false, error } : { ok: true, kind };
}

function infer(value: string): RuleKind {
  if (/^\d+$/.test(value)) return "port";
  if (value.includes("/") || isAddress(value)) return "ip_cidr";
  return "domain_suffix";
}

function isAddress(v: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(v) && v.split(".").every((o) => Number(o) <= 255);
}

function validate(kind: RuleKind, value: string): string | null {
  switch (kind) {
    case "port": {
      const n = Number(value);
      if (!Number.isInteger(n)) return `"${value}" is not a port number.`;
      if (n < 1 || n > 65535) return `Port ${n} is out of range (1-65535).`;
      return null;
    }
    case "ip_cidr":
      return validateCidr(value);
    case "domain_regex":
      try {
        new RegExp(value);
        return null;
      } catch (e) {
        return `Invalid regular expression: ${(e as Error).message}`;
      }
    case "network":
      return value === "tcp" || value === "udp"
        ? null
        : `Network must be "tcp" or "udp", not "${value}".`;
    case "rule_set":
      return isRuleSetTag(value)
        ? null
        : `"${value}" is not a rule set tag. Use letters, digits and . _ @ ! -`;
    default:
      return null;
  }
}

function validateCidr(value: string): string | null {
  const [addr, prefix] = value.split("/", 2);
  if (!isAddress(addr)) return `"${addr}" is not an IP address.`;
  if (prefix !== undefined) {
    const bits = Number(prefix);
    if (!Number.isInteger(bits) || bits < 0 || bits > 32) {
      return `Prefix /${prefix} is too long for this address.`;
    }
  }
  return null;
}

/** One slot per input line: the message, or null when the line is fine. */
export function validateRuleList(lines: string[]): (string | null)[] {
  return lines.map((line) => {
    const got = parseRuleLine(line);
    return got.ok ? null : got.error;
  });
}

/** Same as `rules::valid_tag`. */
export function isRuleSetTag(v: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._@!-]{0,63}$/.test(v);
}

const SAGERNET = /^geo(site|ip)-/;

/** Syntax errors, then tags neither defined nor covered by the SagerNet
 *  fallback: the same refusal `rulesets::validate` makes at save. */
export function checkRuleList(lines: string[], definedTags: string[]): (string | null)[] {
  const known = new Set(definedTags);
  return lines.map((line) => {
    const got = parseRuleLine(line);
    if (!got.ok) return got.error;
    if (got.kind !== "rule_set") return null;
    const text = line.trim();
    const tag = text.slice(text.indexOf(":") + 1).trim();
    return known.has(tag) || SAGERNET.test(tag)
      ? null
      : `Rule set "${tag}" is not defined. Add it under Rule sets.`;
  });
}
