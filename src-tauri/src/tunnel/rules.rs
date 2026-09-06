//! The rule line syntax used by the block / bypass / proxy lists.
//!
//! One rule per line. A prefix sets the type; a bare value is inferred, so
//! pasting a list of domains just works. Validation is deliberately strict
//! and happens here, at save time — a line sing-box would reject must never
//! reach a config, because by then the user is nowhere near the field they
//! typed it into.

use serde_json::{json, Value};
use std::net::IpAddr;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum RuleKind {
    Domain,
    DomainSuffix,
    DomainKeyword,
    DomainRegex,
    IpCidr,
    Port,
    ProcessName,
    ProcessPath,
    RuleSet,
    Network,
}

impl RuleKind {
    /// The sing-box rule field this kind writes into. Also the name the
    /// shared parity fixture uses, so the two grammars are compared on the
    /// same vocabulary.
    pub(crate) fn field(self) -> &'static str {
        match self {
            RuleKind::Domain => "domain",
            RuleKind::DomainSuffix => "domain_suffix",
            RuleKind::DomainKeyword => "domain_keyword",
            RuleKind::DomainRegex => "domain_regex",
            RuleKind::IpCidr => "ip_cidr",
            RuleKind::Port => "port",
            RuleKind::ProcessName => "process_name",
            RuleKind::ProcessPath => "process_path",
            RuleKind::RuleSet => "rule_set",
            RuleKind::Network => "network",
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct RuleEntry {
    pub kind: RuleKind,
    pub value: String,
}

/// What a list does with what it matches.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RuleAction {
    Proxy,
    Direct,
    Reject,
}

const PREFIXES: &[(&str, RuleKind)] = &[
    ("domain", RuleKind::Domain),
    ("suffix", RuleKind::DomainSuffix),
    ("keyword", RuleKind::DomainKeyword),
    ("regex", RuleKind::DomainRegex),
    ("ip", RuleKind::IpCidr),
    ("port", RuleKind::Port),
    ("process", RuleKind::ProcessName),
    ("path", RuleKind::ProcessPath),
    ("ruleset", RuleKind::RuleSet),
    ("network", RuleKind::Network),
];

/// `Ok(None)` means "nothing here" — a blank line or a comment. That is
/// distinct from an error, so a list can carry blank separators.
pub fn parse_line(line: &str) -> Result<Option<RuleEntry>, String> {
    let line = line.trim();
    if line.is_empty() || line.starts_with('#') {
        return Ok(None);
    }

    // `path:/usr/bin/curl` and `regex:^a\..*` both contain characters that
    // look like separators, so split once, on the first colon only.
    let (kind, value) = match line.split_once(':') {
        Some((head, rest)) if PREFIXES.iter().any(|(p, _)| *p == head) => {
            let kind = PREFIXES.iter().find(|(p, _)| *p == head).unwrap().1;
            (kind, rest.trim())
        }
        // A bare IPv6 address also contains colons; inference handles it,
        // and an unknown word before a colon is a typo worth naming.
        Some((head, _)) if head.chars().all(|c| c.is_ascii_alphabetic()) && !line.contains('/') => {
            return Err(format!(
                "Unknown rule prefix \"{head}\". Use one of: domain, suffix, keyword, regex, ip, port, process, path, ruleset, network."
            ));
        }
        _ => (infer_kind(line), line),
    };

    if value.is_empty() {
        return Err("This rule has a prefix but no value.".into());
    }
    validate(kind, value)?;
    Ok(Some(RuleEntry {
        kind,
        value: value.to_string(),
    }))
}

fn infer_kind(value: &str) -> RuleKind {
    if value.chars().all(|c| c.is_ascii_digit()) {
        return RuleKind::Port;
    }
    if value.contains('/') || value.parse::<IpAddr>().is_ok() {
        return RuleKind::IpCidr;
    }
    RuleKind::DomainSuffix
}

fn validate(kind: RuleKind, value: &str) -> Result<(), String> {
    match kind {
        RuleKind::Port => {
            let n: u32 = value
                .parse()
                .map_err(|_| format!("\"{value}\" is not a port number."))?;
            if n == 0 || n > 65535 {
                return Err(format!("Port {n} is out of range (1-65535)."));
            }
        }
        RuleKind::IpCidr => validate_cidr(value)?,
        RuleKind::DomainRegex => {
            regex::Regex::new(value).map_err(|e| format!("Invalid regular expression: {e}"))?;
        }
        RuleKind::Network => {
            if value != "tcp" && value != "udp" {
                return Err(format!("Network must be \"tcp\" or \"udp\", not \"{value}\"."));
            }
        }
        RuleKind::RuleSet => {
            if rule_set_source(value).is_none() {
                return Err(format!(
                    "Unknown rule set \"{value}\". Tags must start with \"geosite-\" or \"geoip-\"."
                ));
            }
        }
        _ => {}
    }
    Ok(())
}

fn validate_cidr(value: &str) -> Result<(), String> {
    let (addr, prefix) = match value.split_once('/') {
        Some((a, p)) => (a, Some(p)),
        None => (value, None),
    };
    let ip: IpAddr = addr
        .parse()
        .map_err(|_| format!("\"{addr}\" is not an IP address."))?;
    if let Some(p) = prefix {
        let bits: u8 = p
            .parse()
            .map_err(|_| format!("\"{p}\" is not a prefix length."))?;
        let max = if ip.is_ipv4() { 32 } else { 128 };
        if bits > max {
            return Err(format!("Prefix /{bits} is too long for this address."));
        }
    }
    Ok(())
}

/// Parses a whole list. Collects **every** bad line rather than stopping at
/// the first, so the editor can underline them all in one pass.
pub fn parse_list(lines: &[String]) -> Result<Vec<RuleEntry>, Vec<(usize, String)>> {
    let mut out = Vec::new();
    let mut errs = Vec::new();
    for (i, line) in lines.iter().enumerate() {
        match parse_line(line) {
            Ok(Some(entry)) => out.push(entry),
            Ok(None) => {}
            Err(e) => errs.push((i, e)),
        }
    }
    if errs.is_empty() {
        Ok(out)
    } else {
        Err(errs)
    }
}

/// One rule object per kind. Different condition types inside a single
/// sing-box rule are ANDed, so a list holding both a domain and a process
/// name must become two rules, not one.
pub fn to_rule_objects(entries: &[RuleEntry], action: RuleAction) -> Vec<Value> {
    let mut kinds: Vec<RuleKind> = entries.iter().map(|e| e.kind).collect();
    kinds.sort();
    kinds.dedup();

    kinds
        .into_iter()
        .map(|kind| {
            let values: Vec<Value> = entries
                .iter()
                .filter(|e| e.kind == kind)
                .map(|e| match kind {
                    RuleKind::Port => json!(e.value.parse::<u16>().unwrap_or_default()),
                    _ => json!(e.value),
                })
                .collect();

            let mut rule = serde_json::Map::new();
            rule.insert(kind.field().to_string(), Value::Array(values));
            match action {
                RuleAction::Proxy => {
                    rule.insert("outbound".into(), json!("proxy"));
                }
                RuleAction::Direct => {
                    rule.insert("outbound".into(), json!("direct"));
                }
                // sing-box 1.11+ expresses rejection as a rule action; the
                // old `block` outbound is deprecated.
                RuleAction::Reject => {
                    rule.insert("action".into(), json!("reject"));
                }
            }
            Value::Object(rule)
        })
        .collect()
}

/// The `route.rule_set` source entry for a tag. Only the two official
/// SagerNet repositories can be resolved to a URL, so anything else is
/// rejected at parse time rather than failing at start.
pub fn rule_set_source(tag: &str) -> Option<Value> {
    let repo = if tag.starts_with("geosite-") {
        "sing-geosite"
    } else if tag.starts_with("geoip-") {
        "sing-geoip"
    } else {
        return None;
    };
    Some(json!({
        "tag": tag,
        "type": "remote",
        "format": "binary",
        "url": format!(
            "https://raw.githubusercontent.com/SagerNet/{repo}/rule-set/{tag}.srs"
        ),
        // Through the proxy, not direct: a user who needs this application
        // is plausibly unable to reach raw.githubusercontent.com directly.
        "download_detour": "proxy"
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_bare_domain_is_inferred_as_a_suffix() {
        let e = parse_line("example.com").unwrap().unwrap();
        assert_eq!(e.kind, RuleKind::DomainSuffix);
        assert_eq!(e.value, "example.com");
    }

    #[test]
    fn a_bare_cidr_or_address_is_inferred_as_ip() {
        assert_eq!(parse_line("10.0.0.0/8").unwrap().unwrap().kind, RuleKind::IpCidr);
        assert_eq!(parse_line("1.1.1.1").unwrap().unwrap().kind, RuleKind::IpCidr);
    }

    #[test]
    fn a_bare_number_is_inferred_as_a_port() {
        let e = parse_line("443").unwrap().unwrap();
        assert_eq!(e.kind, RuleKind::Port);
        assert_eq!(e.value, "443");
    }

    #[test]
    fn every_documented_prefix_parses() {
        let cases = [
            ("domain:example.com", RuleKind::Domain),
            ("suffix:example.com", RuleKind::DomainSuffix),
            ("keyword:google", RuleKind::DomainKeyword),
            (r"regex:^ads\..*", RuleKind::DomainRegex),
            ("ip:10.0.0.0/8", RuleKind::IpCidr),
            ("port:8080", RuleKind::Port),
            ("process:Telegram", RuleKind::ProcessName),
            ("path:/usr/bin/curl", RuleKind::ProcessPath),
            ("ruleset:geosite-ir", RuleKind::RuleSet),
            ("network:udp", RuleKind::Network),
        ];
        for (line, kind) in cases {
            assert_eq!(parse_line(line).unwrap().unwrap().kind, kind, "line: {line}");
        }
    }

    #[test]
    fn blank_and_commented_lines_are_skipped_not_rejected() {
        assert!(parse_line("").unwrap().is_none());
        assert!(parse_line("   ").unwrap().is_none());
        assert!(parse_line("# a note").unwrap().is_none());
    }

    #[test]
    fn surrounding_whitespace_is_trimmed() {
        assert_eq!(parse_line("  example.com  ").unwrap().unwrap().value, "example.com");
    }

    #[test]
    fn an_unknown_prefix_is_an_error_naming_it() {
        let err = parse_line("banana:x").unwrap_err();
        assert!(err.contains("banana"), "message should name the prefix: {err}");
    }

    #[test]
    fn a_prefix_with_an_empty_value_is_rejected() {
        assert!(parse_line("domain:").is_err());
        assert!(parse_line("process:   ").is_err());
    }

    #[test]
    fn a_port_out_of_range_is_rejected() {
        assert!(parse_line("port:70000").is_err());
        assert!(parse_line("port:0").is_err());
    }

    #[test]
    fn a_malformed_cidr_is_rejected() {
        assert!(parse_line("ip:10.0.0.0/99").is_err());
        assert!(parse_line("ip:not-an-ip").is_err());
    }

    #[test]
    fn an_invalid_regex_is_rejected_at_parse_time_not_at_runtime() {
        assert!(parse_line("regex:[unclosed").is_err());
    }

    #[test]
    fn a_network_other_than_tcp_or_udp_is_rejected() {
        assert!(parse_line("network:sctp").is_err());
        assert!(parse_line("network:tcp").is_ok());
    }

    #[test]
    fn parse_list_reports_every_bad_line_with_its_index() {
        let lines: Vec<String> = ["example.com", "banana:x", "", "port:0"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        let errs = parse_list(&lines).unwrap_err();
        assert_eq!(errs.len(), 2);
        assert_eq!(errs[0].0, 1);
        assert_eq!(errs[1].0, 3);
    }

    #[test]
    fn entries_of_the_same_kind_collapse_into_one_rule_object() {
        let entries = parse_list(&[
            "a.com".to_string(),
            "b.com".to_string(),
        ])
        .unwrap();
        let out = to_rule_objects(&entries, RuleAction::Direct);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0], json!({ "domain_suffix": ["a.com", "b.com"], "outbound": "direct" }));
    }

    #[test]
    fn entries_of_different_kinds_become_separate_rule_objects() {
        // Within one sing-box rule, different condition types are ANDed.
        // Merging a domain and a process into one object would mean "both
        // must match", which is never what a list means.
        let entries = parse_list(&["a.com".to_string(), "process:curl".to_string()]).unwrap();
        let out = to_rule_objects(&entries, RuleAction::Reject);
        assert_eq!(out.len(), 2);
        assert!(out.iter().all(|r| r["action"] == json!("reject")));
        assert!(out.iter().any(|r| r["domain_suffix"] == json!(["a.com"])));
        assert!(out.iter().any(|r| r["process_name"] == json!(["curl"])));
    }

    #[test]
    fn ports_are_emitted_as_numbers_not_strings() {
        let entries = parse_list(&["port:8080".to_string()]).unwrap();
        let out = to_rule_objects(&entries, RuleAction::Proxy);
        assert_eq!(out[0], json!({ "port": [8080], "outbound": "proxy" }));
    }

    #[test]
    fn rejection_uses_the_action_form_not_a_block_outbound() {
        let entries = parse_list(&["a.com".to_string()]).unwrap();
        let out = to_rule_objects(&entries, RuleAction::Reject);
        assert_eq!(out[0]["action"], json!("reject"));
        assert!(out[0].get("outbound").is_none());
    }

    #[test]
    fn an_empty_entry_list_produces_no_rule_objects() {
        assert!(to_rule_objects(&[], RuleAction::Proxy).is_empty());
    }

    #[test]
    fn a_geosite_tag_resolves_to_its_remote_rule_set_source() {
        let src = rule_set_source("geosite-ir").unwrap();
        assert_eq!(src["tag"], json!("geosite-ir"));
        assert_eq!(src["type"], json!("remote"));
        assert_eq!(src["format"], json!("binary"));
        assert_eq!(src["download_detour"], json!("proxy"));
        assert!(src["url"].as_str().unwrap().contains("sing-geosite"));
    }

    #[test]
    fn a_geoip_tag_resolves_to_the_geoip_repository() {
        let src = rule_set_source("geoip-ir").unwrap();
        assert!(src["url"].as_str().unwrap().contains("sing-geoip"));
    }

    #[test]
    fn an_unprefixed_rule_set_tag_is_rejected() {
        // We can only build a URL for the two official repositories.
        assert!(rule_set_source("my-custom-set").is_none());
    }

    /// The other half of `src/lib/rules.test.ts`'s parity suite, reading the
    /// same file. `src/lib/rules.ts` duplicates this grammar deliberately —
    /// the editor needs a verdict per keystroke — and this test is the only
    /// thing between that and two grammars that quietly disagree.
    ///
    /// A line the editor accepts and this rejects is a save that fails for
    /// no visible reason. A line this accepts and the editor underlines is
    /// a rule the user deletes because we told them it was wrong.
    #[test]
    fn both_grammars_agree_on_every_line_in_the_shared_fixture() {
        let raw = include_str!("../../../src/lib/rules.fixtures.json");
        let table: serde_json::Value = serde_json::from_str(raw).expect("fixture json");
        let cases = table["cases"].as_array().expect("cases array");
        assert!(
            cases.len() > 20,
            "a truncated fixture would pass as agreement"
        );

        for case in cases {
            let line = case["line"].as_str().expect("line");
            let expected = &case["kind"];
            let got = parse_line(line);
            if expected.is_null() {
                assert!(got.is_err(), "{line:?} should be rejected, got {got:?}");
            } else if expected == "none" {
                assert_eq!(got.unwrap(), None, "{line:?} should be skipped");
            } else {
                let entry = got
                    .unwrap_or_else(|e| panic!("{line:?} should parse: {e}"))
                    .unwrap_or_else(|| panic!("{line:?} should not be skipped"));
                assert_eq!(
                    entry.kind.field(),
                    expected.as_str().unwrap(),
                    "{line:?}"
                );
            }
        }
    }

}
