//! The kill switch and the route guard, as one lifetime.
//!
//! Raised before sing-box starts and lowered after it has stopped (design
//! §11.4). There is deliberately no `Drop`: an engine that loses its GUI
//! without a `TunnelStop` lets the guard go out of scope, and the rules stay
//! in force. That is the fail-closed half of the design, and the GUI's crash
//! marker is the half that brings the user back to open it.

use crate::killswitch::{self, Allowlist, KillSwitch};
use crate::route_guard::{self, RouteGuard};
use crate::passthrough::{self, PassRules};
use crate::proto::PassthroughStatus;

pub type Opener = Box<dyn Fn() -> Result<Box<dyn KillSwitch>, String> + Send>;
pub type Discover = Box<dyn Fn(&str) -> PassthroughStatus + Send>;

pub struct TunGuard {
    /// `None` while the user has the kill switch off. The pinned route
    /// still matters (ClientHello injection needs the physical egress).
    ks: Option<Box<dyn KillSwitch>>,
    route: Option<RouteGuard>,
    allow: Allowlist,
    open: Opener,
    discover: Discover,
    /// `None` in tests; the rules need root.
    rules: Option<PassRules>,
    found: Vec<PassthroughStatus>,
}

impl TunGuard {
    pub fn raise(allow: Allowlist) -> Result<TunGuard, String> {
        let ks = if allow.enforce {
            let mut ks = killswitch::open()?;
            ks.install(&allow)?;
            Some(ks)
        } else {
            None
        };
        let undo = |ks: Option<Box<dyn KillSwitch>>| {
            if let Some(mut ks) = ks {
                let _ = ks.remove();
            }
        };
        let rules = match PassRules::locate() {
            Ok(r) => r,
            Err(e) => {
                undo(ks);
                return Err(e);
            }
        };
        let route = match RouteGuard::install(allow.connect.0) {
            Ok(r) => r,
            Err(e) => {
                undo(ks);
                return Err(e);
            }
        };
        Ok(TunGuard {
            ks, route: Some(route), allow,
            open: Box::new(killswitch::open),
            discover: Box::new(passthrough::discover),
            rules: Some(rules),
            found: Vec::new(),
        })
    }

    pub fn with_parts(
        ks: Option<Box<dyn KillSwitch>>,
        route: Option<RouteGuard>,
        allow: Allowlist,
        open: Opener,
        discover: Discover,
    ) -> TunGuard {
        TunGuard { ks, route, allow, open, discover, rules: None, found: Vec::new() }
    }

    pub fn allow(&self) -> &Allowlist {
        &self.allow
    }

    pub fn permit_interface(&mut self, name: &str) -> Result<(), String> {
        match self.ks.as_mut() {
            Some(ks) => ks.permit_interface(name),
            None => Ok(()),
        }
    }

    /// Puts `allow` in force: table installed, updated or removed, as
    /// `enforce` says. Never lifts an enabled drop.
    fn apply(&mut self, allow: &Allowlist) -> Result<(), String> {
        if allow.enforce {
            match self.ks.as_mut() {
                Some(ks) => ks.update(allow)?,
                None => {
                    let mut ks = (self.open)()?;
                    ks.install(allow)?;
                    self.ks = Some(ks);
                }
            }
        } else if let Some(mut ks) = self.ks.take() {
            if let Err(e) = ks.remove() {
                self.ks = Some(ks);
                return Err(e);
            }
        }
        Ok(())
    }

    /// A profile switch, a new interface list, or the kill switch toggled.
    /// The servers found so far survive: the GUI never sends them.
    pub fn retarget(&mut self, mut allow: Allowlist) -> Result<(), String> {
        allow.endpoints = self.allow.endpoints.clone();
        self.apply(&allow)?;
        let moved = allow.connect.0 != self.allow.connect.0;
        self.allow = allow;
        if moved {
            if let Some(old) = self.route.take() {
                let _ = old.remove();
                self.route = Some(RouteGuard::install(self.allow.connect.0)?);
            }
        }
        Ok(())
    }

    /// Re-discovers every named interface. On a change (or when `force`d),
    /// re-applies the servers to the kill switch and replaces the policy
    /// rules, and returns what it found for the GUI.
    pub fn refresh(&mut self, force: bool) -> Result<Option<Vec<PassthroughStatus>>, String> {
        let found: Vec<PassthroughStatus> =
            self.allow.interfaces.iter().map(|n| (self.discover)(n)).collect();
        if !force && found == self.found {
            return Ok(None);
        }
        let mut next = self.allow.clone();
        next.endpoints = found
            .iter()
            .flat_map(|s| s.endpoints.iter())
            .filter_map(|e| e.ip.parse().ok().map(|ip| (ip, e.port)))
            .collect();
        self.apply(&next)?;
        self.allow = next;
        if let Some(rules) = &self.rules {
            rules.replace(&found)?;
        }
        self.found = found.clone();
        Ok(Some(found))
    }

    pub fn lower(&mut self) -> Result<(), String> {
        if let Some(rules) = &self.rules {
            rules.clear();
        }
        let route = match self.route.take() {
            Some(r) => r.remove(),
            None => Ok(()),
        };
        let ks = match self.ks.as_mut() {
            Some(ks) => ks.remove(),
            None => Ok(()),
        };
        if ks.is_ok() {
            self.ks = None;
        }
        route.and(ks)
    }
}

/// Both halves' leftovers, by their fixed names.
pub fn purge_leftovers() -> Result<(), String> {
    let ks = killswitch::purge_leftovers();
    let route = route_guard::purge();
    ks.and(route)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::Ipv4Addr;
    use std::sync::{Arc, Mutex};
    use crate::proto::{Endpoint, PassthroughStatus};

    /// Records every call, and fails the ones it is told to.
    struct Fake {
        calls: Arc<Mutex<Vec<String>>>,
        fail_update: bool,
    }

    impl KillSwitch for Fake {
        fn install(&mut self, a: &Allowlist) -> Result<(), String> {
            self.calls.lock().unwrap().push(format!("install {}", a.connect.0));
            Ok(())
        }
        fn permit_interface(&mut self, n: &str) -> Result<(), String> {
            self.calls.lock().unwrap().push(format!("permit {n}"));
            Ok(())
        }
        fn update(&mut self, a: &Allowlist) -> Result<(), String> {
            if self.fail_update {
                return Err("refused".into());
            }
            self.calls.lock().unwrap().push(format!("update {}", a.connect.0));
            Ok(())
        }
        fn remove(&mut self) -> Result<(), String> {
            self.calls.lock().unwrap().push("remove".into());
            Ok(())
        }
    }

    fn allow(last: u8) -> Allowlist {
        Allowlist { connect: (Ipv4Addr::new(10, 0, 0, last), 443), allow_lan: true, enforce: true, interfaces: vec![], endpoints: vec![] }
    }


    fn status(name: &str, ep: Option<&str>) -> PassthroughStatus {
        PassthroughStatus {
            name: name.into(), present: ep.is_some(), kind: None,
            endpoints: ep.map(|ip| vec![Endpoint { ip: ip.into(), port: 51820 }]).unwrap_or_default(),
            routes: vec![], problem: None,
        }
    }

    fn guard_with(enforce: bool, fail_update: bool, seen: Arc<Mutex<Option<String>>>)
        -> (TunGuard, Arc<Mutex<Vec<String>>>)
    {
        let calls = Arc::new(Mutex::new(Vec::new()));
        let ks: Option<Box<dyn KillSwitch>> =
            enforce.then(|| Box::new(Fake { calls: calls.clone(), fail_update }) as Box<dyn KillSwitch>);
        let c = calls.clone();
        let open: Opener = Box::new(move || Ok(Box::new(Fake { calls: c.clone(), fail_update: false })));
        let discover: Discover = Box::new(move |n| status(n, seen.lock().unwrap().as_deref()));
        let mut a = allow(1);
        a.enforce = enforce;
        a.interfaces = vec!["wg0".into()];
        (TunGuard::with_parts(ks, None, a, open, discover), calls)
    }

    fn guard(fail_update: bool) -> (TunGuard, Arc<Mutex<Vec<String>>>) {
        guard_with(true, fail_update, Arc::new(Mutex::new(None)))
    }

    #[test]
    fn turning_the_kill_switch_off_removes_only_the_table() {
        let (mut g, calls) = guard(false);
        let mut next = g.allow().clone();
        next.enforce = false;
        g.retarget(next).unwrap();
        assert_eq!(*calls.lock().unwrap(), ["remove"]);
    }

    #[test]
    fn turning_it_back_on_installs_it() {
        let (mut g, calls) = guard_with(false, false, Arc::new(Mutex::new(None)));
        let mut next = g.allow().clone();
        next.enforce = true;
        g.retarget(next).unwrap();
        assert_eq!(*calls.lock().unwrap(), ["install 10.0.0.1"]);
    }

    #[test]
    fn a_vpn_that_appears_later_is_picked_up_on_the_next_tick() {
        let seen = Arc::new(Mutex::new(None));
        let (mut g, calls) = guard_with(true, false, seen.clone());
        // The engine forces one right after the core starts (main.rs).
        g.refresh(true).unwrap();
        assert!(g.refresh(false).unwrap().is_none(), "nothing changed yet");
        *seen.lock().unwrap() = Some("37.191.85.82".into());
        let items = g.refresh(false).unwrap().expect("a change is reported");
        assert_eq!(items[0].endpoints[0].ip, "37.191.85.82");
        assert_eq!(g.allow().endpoints, [(Ipv4Addr::new(37, 191, 85, 82), 51820)]);
        assert_eq!(calls.lock().unwrap().last().unwrap(), "update 10.0.0.1");
        assert!(g.refresh(false).unwrap().is_none(), "unchanged again");
    }

    #[test]
    fn a_forced_refresh_always_reports() {
        let (mut g, _) = guard(false);
        assert!(g.refresh(true).unwrap().is_some());
    }

    #[test]
    fn a_retarget_keeps_the_discovered_servers() {
        let seen = Arc::new(Mutex::new(Some("37.191.85.82".to_string())));
        let (mut g, _) = guard_with(true, false, seen);
        g.refresh(true).unwrap();
        let next = Allowlist { endpoints: vec![], ..allow(2) };
        g.retarget(Allowlist { enforce: true, interfaces: vec!["wg0".into()], ..next }).unwrap();
        assert_eq!(g.allow().endpoints.len(), 1);
    }

    #[test]
    fn lowering_without_a_kill_switch_touches_no_table() {
        let (mut g, calls) = guard_with(false, false, Arc::new(Mutex::new(None)));
        g.lower().unwrap();
        assert!(calls.lock().unwrap().is_empty());
    }

    #[test]
    fn a_retarget_updates_and_never_removes() {
        // Removing and reinstalling would open a window with no drop at all.
        let (mut g, calls) = guard(false);
        g.retarget(allow(2)).unwrap();
        assert_eq!(*calls.lock().unwrap(), ["update 10.0.0.2"]);
        assert_eq!(g.allow().connect.0, Ipv4Addr::new(10, 0, 0, 2));
    }

    #[test]
    fn a_refused_retarget_keeps_the_old_upstream() {
        let (mut g, _) = guard(true);
        assert!(g.retarget(allow(2)).is_err());
        assert_eq!(g.allow().connect.0, Ipv4Addr::new(10, 0, 0, 1));
    }

    #[test]
    fn lowering_removes_the_kill_switch() {
        let (mut g, calls) = guard(false);
        g.lower().unwrap();
        assert_eq!(*calls.lock().unwrap(), ["remove"]);
    }

    #[test]
    fn permitting_the_interface_reaches_the_backend() {
        let (mut g, calls) = guard(false);
        g.permit_interface("snifake-tun0").unwrap();
        assert_eq!(*calls.lock().unwrap(), ["permit snifake-tun0"]);
    }
}
