//! Named connection presets, stored as a single JSON document in the app
//! data dir. Replaces the old single `config.json`, which is migrated into
//! a profile called "Default" on first run and then left alone.

use crate::config::app_dir;
use serde::{Deserialize, Serialize};
use snifake_engine::proto::Profile;
use std::fs;
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(default)]
pub struct Store {
    pub profiles: Vec<Profile>,
    pub active_id: Option<String>,
}

pub fn profiles_path() -> PathBuf {
    app_dir().join("profiles.json")
}

fn legacy_path() -> PathBuf {
    app_dir().join("config.json")
}

/// Monotonic-enough unique id. Profiles are created by hand at human speed;
/// a nanosecond timestamp cannot collide in practice.
fn new_id() -> String {
    format!(
        "p{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    )
}

fn default_profile() -> Profile {
    Profile {
        id: new_id(),
        name: "Default".into(),
        listen_host: "127.0.0.1".into(),
        listen_port: 40443,
        connect_ip: "103.160.204.34".into(),
        connect_port: 443,
        fake_sni: "chatgpt.com".into(),
    }
}

/// The shape of the pre-profiles `config.json`.
#[derive(Deserialize)]
#[serde(default)]
struct Legacy {
    #[serde(rename = "LISTEN_HOST")]
    listen_host: String,
    #[serde(rename = "LISTEN_PORT")]
    listen_port: u16,
    #[serde(rename = "CONNECT_IP")]
    connect_ip: String,
    #[serde(rename = "CONNECT_PORT")]
    connect_port: u16,
    #[serde(rename = "FAKE_SNI")]
    fake_sni: String,
}

impl Default for Legacy {
    fn default() -> Self {
        let p = default_profile();
        Legacy {
            listen_host: p.listen_host,
            listen_port: p.listen_port,
            connect_ip: p.connect_ip,
            connect_port: p.connect_port,
            fake_sni: p.fake_sni,
        }
    }
}

pub fn migrate_from_legacy(body: &str) -> Option<Store> {
    let legacy: Legacy = serde_json::from_str(body).ok()?;
    let profile = Profile {
        id: new_id(),
        name: "Default".into(),
        listen_host: legacy.listen_host,
        listen_port: legacy.listen_port,
        connect_ip: legacy.connect_ip,
        connect_port: legacy.connect_port,
        fake_sni: legacy.fake_sni,
    };
    let id = profile.id.clone();
    Some(Store {
        profiles: vec![profile],
        active_id: Some(id),
    })
}

pub fn load() -> Store {
    if let Ok(body) = fs::read_to_string(profiles_path()) {
        if let Ok(store) = serde_json::from_str::<Store>(&body) {
            if !store.profiles.is_empty() {
                return store;
            }
        }
    }
    if let Ok(body) = fs::read_to_string(legacy_path()) {
        if let Some(store) = migrate_from_legacy(&body) {
            let _ = save(&store);
            return store;
        }
    }
    let profile = default_profile();
    let id = profile.id.clone();
    let store = Store {
        profiles: vec![profile],
        active_id: Some(id),
    };
    let _ = save(&store);
    store
}

pub fn save(store: &Store) -> Result<(), String> {
    fs::create_dir_all(app_dir()).map_err(|e| e.to_string())?;
    let body = serde_json::to_string_pretty(store).map_err(|e| e.to_string())?;
    fs::write(profiles_path(), body).map_err(|e| e.to_string())
}

pub fn upsert(store: &mut Store, profile: Profile) {
    match store.profiles.iter_mut().find(|p| p.id == profile.id) {
        Some(existing) => *existing = profile,
        None => store.profiles.push(profile),
    }
}

pub fn delete(store: &mut Store, id: &str) -> Result<(), String> {
    if store.profiles.len() <= 1 {
        return Err("The last profile cannot be deleted.".into());
    }
    store.profiles.retain(|p| p.id != id);
    if store.active_id.as_deref() == Some(id) {
        store.active_id = store.profiles.first().map(|p| p.id.clone());
    }
    Ok(())
}

pub fn active(store: &Store) -> Option<&Profile> {
    let id = store.active_id.as_deref()?;
    store.profiles.iter().find(|p| p.id == id)
}

pub fn set_active(store: &mut Store, id: &str) -> Result<(), String> {
    if !store.profiles.iter().any(|p| p.id == id) {
        return Err(format!("no profile with id '{id}'"));
    }
    store.active_id = Some(id.to_string());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn profile(id: &str, name: &str) -> Profile {
        Profile {
            id: id.into(),
            name: name.into(),
            listen_host: "127.0.0.1".into(),
            listen_port: 40443,
            connect_ip: "104.18.4.130".into(),
            connect_port: 443,
            fake_sni: "example.com".into(),
        }
    }

    #[test]
    fn migrates_a_legacy_config_into_a_single_default_profile() {
        let legacy = r#"{
            "LISTEN_HOST": "0.0.0.0",
            "LISTEN_PORT": 40443,
            "CONNECT_IP": "103.160.204.34",
            "CONNECT_PORT": 443,
            "FAKE_SNI": "chatgpt.com"
        }"#;
        let store = migrate_from_legacy(legacy).unwrap();
        assert_eq!(store.profiles.len(), 1);
        assert_eq!(store.profiles[0].name, "Default");
        assert_eq!(store.profiles[0].connect_ip, "103.160.204.34");
        assert_eq!(
            store.active_id.as_deref(),
            Some(store.profiles[0].id.as_str())
        );
    }

    #[test]
    fn migration_of_a_partial_legacy_config_fills_in_defaults() {
        let store = migrate_from_legacy(r#"{"FAKE_SNI":"example.com"}"#).unwrap();
        assert_eq!(store.profiles[0].fake_sni, "example.com");
        assert_eq!(store.profiles[0].listen_port, 40443);
    }

    #[test]
    fn migration_rejects_junk() {
        assert!(migrate_from_legacy("not json").is_none());
    }

    #[test]
    fn upsert_replaces_by_id_and_appends_new_ids() {
        let mut store = Store {
            profiles: vec![profile("a", "A")],
            active_id: Some("a".into()),
        };
        upsert(&mut store, profile("a", "A renamed"));
        assert_eq!(store.profiles.len(), 1);
        assert_eq!(store.profiles[0].name, "A renamed");
        upsert(&mut store, profile("b", "B"));
        assert_eq!(store.profiles.len(), 2);
    }

    #[test]
    fn delete_refuses_to_remove_the_last_profile() {
        let mut store = Store {
            profiles: vec![profile("a", "A")],
            active_id: Some("a".into()),
        };
        assert!(delete(&mut store, "a").is_err());
        assert_eq!(store.profiles.len(), 1);
    }

    #[test]
    fn deleting_the_active_profile_moves_active_to_the_first_survivor() {
        let mut store = Store {
            profiles: vec![profile("a", "A"), profile("b", "B")],
            active_id: Some("a".into()),
        };
        delete(&mut store, "a").unwrap();
        assert_eq!(store.active_id.as_deref(), Some("b"));
    }

    #[test]
    fn active_returns_none_when_the_id_does_not_resolve() {
        let store = Store {
            profiles: vec![profile("a", "A")],
            active_id: Some("zz".into()),
        };
        assert!(active(&store).is_none());
    }

    #[test]
    fn setting_an_unknown_active_id_is_rejected() {
        let mut store = Store {
            profiles: vec![profile("a", "A")],
            active_id: Some("a".into()),
        };
        assert!(set_active(&mut store, "nope").is_err());
        assert_eq!(store.active_id.as_deref(), Some("a"));
        assert!(set_active(&mut store, "a").is_ok());
    }
}
