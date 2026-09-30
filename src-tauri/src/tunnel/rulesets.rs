//! User-defined rule sets: resolution, validation and the sing-box entry.

use super::model::{DefaultRoute, RuleSetDef, RuleSetFormat, RuleSetSource};
use super::rules::{parse_line, rule_set_source, valid_tag, RuleKind};
use crate::config::app_dir;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

pub fn dir() -> PathBuf {
    app_dir().join("rulesets")
}

pub fn source_of(d: &RuleSetDef) -> Value {
    let format = match d.format {
        RuleSetFormat::Binary => "binary",
        RuleSetFormat::Source => "source",
    };
    match &d.source {
        RuleSetSource::Remote { url, detour } => json!({
            "tag": d.tag, "type": "remote", "format": format, "url": url,
            "download_detour": match detour { DefaultRoute::Proxy => "proxy", DefaultRoute::Direct => "direct" }
        }),
        RuleSetSource::Local { path } => json!({
            "tag": d.tag, "type": "local", "format": format, "path": path
        }),
    }
}

pub fn unresolved(tag: &str, defs: &[RuleSetDef]) -> Option<String> {
    if defs.iter().any(|d| d.tag == tag) || rule_set_source(tag).is_some() {
        return None;
    }
    Some(format!("Rule set \"{tag}\" is not defined. Add it under Rule sets."))
}

pub fn used_tags(lists: &[&[String]]) -> Vec<String> {
    let mut tags: Vec<String> = lists
        .iter()
        .flat_map(|l| l.iter())
        .filter_map(|line| parse_line(line).ok().flatten())
        .filter(|e| e.kind == RuleKind::RuleSet)
        .map(|e| e.value)
        .collect();
    tags.sort();
    tags.dedup();
    tags
}

pub fn validate(defs: &[RuleSetDef], lists: &[&[String]], dir: &Path) -> Result<(), String> {
    for (i, d) in defs.iter().enumerate() {
        if !valid_tag(&d.tag) {
            return Err(format!("\"{}\" is not a rule set tag.", d.tag));
        }
        if defs[..i].iter().any(|o| o.tag == d.tag) {
            return Err(format!("Rule set \"{}\" is defined twice.", d.tag));
        }
        match &d.source {
            RuleSetSource::Remote { url, .. } => {
                let ok = (url.starts_with("https://") || url.starts_with("http://"))
                    && url.len() <= 2048
                    && !url.chars().any(char::is_whitespace);
                if !ok {
                    return Err(format!("Rule set \"{}\": the URL must start with http:// or https://.", d.tag));
                }
            }
            RuleSetSource::Local { path } => {
                if !Path::new(path).starts_with(dir) {
                    return Err(format!("Rule set \"{}\": import the file again.", d.tag));
                }
            }
        }
    }
    for tag in used_tags(lists) {
        if let Some(e) = unresolved(&tag, defs) {
            return Err(e);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tunnel::model::{DefaultRoute, RuleSetFormat, RuleSetSource};
    use serde_json::json;

    const DIR: &str = "/data/rulesets";
    fn remote(tag: &str, url: &str) -> RuleSetDef {
        RuleSetDef { tag: tag.into(), format: RuleSetFormat::Binary,
            source: RuleSetSource::Remote { url: url.into(), detour: DefaultRoute::Proxy } }
    }

    #[test]
    fn a_remote_definition_becomes_a_remote_rule_set() {
        assert_eq!(source_of(&remote("geoip-ir", "https://example.org/geoip-ir.srs")), json!({
            "tag": "geoip-ir", "type": "remote", "format": "binary",
            "url": "https://example.org/geoip-ir.srs", "download_detour": "proxy" }));
    }

    #[test]
    fn a_local_definition_becomes_a_local_rule_set() {
        let d = RuleSetDef { tag: "mine".into(), format: RuleSetFormat::Source,
            source: RuleSetSource::Local { path: "/data/rulesets/mine.json".into() } };
        assert_eq!(source_of(&d), json!({ "tag": "mine", "type": "local", "format": "source",
            "path": "/data/rulesets/mine.json" }));
    }

    #[test]
    fn a_line_using_an_undefined_tag_is_refused_at_save() {
        let bypass = vec!["ruleset:mine".to_string()];
        let err = validate(&[], &[&bypass], Path::new(DIR)).unwrap_err();
        assert!(err.contains("\"mine\""), "{err}");
    }

    #[test]
    fn a_sagernet_tag_still_needs_no_definition() {
        let bypass = vec!["ruleset:geoip-ir".to_string()];
        assert!(validate(&[], &[&bypass], Path::new(DIR)).is_ok());
    }

    #[test]
    fn duplicate_tags_and_non_http_urls_are_refused() {
        let a = remote("x", "https://a/x.srs");
        assert!(validate(&[a.clone(), a], &[], Path::new(DIR)).is_err());
        assert!(validate(&[remote("x", "file:///etc/shadow")], &[], Path::new(DIR)).is_err());
    }

    #[test]
    fn a_local_path_outside_the_rulesets_directory_is_refused() {
        let d = RuleSetDef { tag: "x".into(), format: RuleSetFormat::Binary,
            source: RuleSetSource::Local { path: "/etc/x.srs".into() } };
        assert!(validate(&[d], &[], Path::new(DIR)).is_err());
    }
}
