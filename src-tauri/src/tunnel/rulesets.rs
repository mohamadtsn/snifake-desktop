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

/// Rule sets are small; this only stops a mis-click on a disk image.
const MAX_IMPORT: u64 = 32 * 1024 * 1024;

/// Copied, not referenced: the original can move or vanish, and a root
/// core reading an arbitrary user path is a question nobody needs to ask.
pub fn import_into(src: &Path, tag: &str, dir: &Path) -> Result<RuleSetDef, String> {
    if !valid_tag(tag) {
        return Err(format!("\"{tag}\" is not a rule set tag."));
    }
    let name = src.to_string_lossy().to_ascii_lowercase();
    let (format, ext) = if name.ends_with(".srs") {
        (RuleSetFormat::Binary, "srs")
    } else if name.ends_with(".json") {
        (RuleSetFormat::Source, "json")
    } else {
        return Err("Choose a .srs (binary) or .json (source) rule set.".into());
    };
    let len = std::fs::metadata(src).map_err(|e| e.to_string())?.len();
    if len > MAX_IMPORT {
        return Err("That file is too large to be a rule set.".into());
    }
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let dest = dir.join(format!("{tag}.{ext}"));
    std::fs::copy(src, &dest).map_err(|e| e.to_string())?;
    Ok(RuleSetDef {
        tag: tag.into(),
        format,
        source: RuleSetSource::Local { path: dest.to_string_lossy().into_owned() },
    })
}

/// Deletes imported files no saved definition points at. Best effort.
pub fn prune(defs: &[RuleSetDef], dir: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        let used = defs.iter().any(|d| matches!(&d.source,
            RuleSetSource::Local { path: p } if Path::new(p) == path));
        if !used {
            let _ = std::fs::remove_file(path);
        }
    }
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

    fn tempdir() -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("snifake-rs-{}", std::process::id()))
            .join(format!("{:?}", std::thread::current().id()).replace(['(', ')'], ""));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn an_imported_file_is_copied_under_its_tag() {
        let t = tempdir();
        let src = t.join("downloaded.srs");
        std::fs::write(&src, b"SRS").unwrap();
        let d = import_into(&src, "geoip-ir", &t.join("rulesets")).unwrap();
        assert_eq!(d.format, RuleSetFormat::Binary);
        let RuleSetSource::Local { path } = &d.source else { panic!() };
        assert!(path.ends_with("rulesets/geoip-ir.srs"));
        assert_eq!(std::fs::read(path).unwrap(), b"SRS");
    }

    #[test]
    fn only_srs_and_json_are_accepted() {
        let t = tempdir();
        let src = t.join("list.txt");
        std::fs::write(&src, b"x").unwrap();
        assert!(import_into(&src, "x", &t.join("rulesets")).is_err());
    }

    #[test]
    fn prune_removes_files_no_definition_uses() {
        let t = tempdir();
        let dir = t.join("rulesets");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("keep.srs"), b"").unwrap();
        std::fs::write(dir.join("gone.srs"), b"").unwrap();
        let keep = RuleSetDef { tag: "keep".into(), format: RuleSetFormat::Binary,
            source: RuleSetSource::Local { path: dir.join("keep.srs").to_string_lossy().into() } };
        prune(&[keep], &dir);
        assert!(dir.join("keep.srs").exists());
        assert!(!dir.join("gone.srs").exists());
    }
}
