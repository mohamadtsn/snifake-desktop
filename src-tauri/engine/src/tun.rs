//! The kill switch and the route guard, as one lifetime.
//!
//! Raised before sing-box starts and lowered after it has stopped (design
//! §11.4). There is deliberately no `Drop`: an engine that loses its GUI
//! without a `TunnelStop` lets the guard go out of scope, and the rules stay
//! in force. That is the fail-closed half of the design, and the GUI's crash
//! marker is the half that brings the user back to open it.

use crate::killswitch::{self, Allowlist, KillSwitch};
use crate::route_guard::{self, RouteGuard};

pub struct TunGuard {
    ks: Box<dyn KillSwitch>,
    route: Option<RouteGuard>,
    allow: Allowlist,
}

impl TunGuard {
    /// Kill switch first, then the route (design §11.4, steps 3 and 4). A
    /// route that cannot be pinned takes the kill switch back down: nothing
    /// has started yet, so there is nothing to protect.
    pub fn raise(allow: Allowlist) -> Result<TunGuard, String> {
        let mut ks = killswitch::open()?;
        ks.install(&allow)?;
        let route = match RouteGuard::install(allow.connect.0) {
            Ok(r) => r,
            Err(e) => {
                let _ = ks.remove();
                return Err(e);
            }
        };
        Ok(TunGuard { ks, route: Some(route), allow })
    }

    pub fn with_parts(ks: Box<dyn KillSwitch>, route: Option<RouteGuard>, allow: Allowlist) -> TunGuard {
        TunGuard { ks, route, allow }
    }

    pub fn allow(&self) -> &Allowlist {
        &self.allow
    }

    pub fn permit_interface(&mut self, name: &str) -> Result<(), String> {
        self.ks.permit_interface(name)
    }

    /// A profile switch. The drop never lifts: the kill switch is updated
    /// in place, and only the route is replaced.
    pub fn retarget(&mut self, allow: Allowlist) -> Result<(), String> {
        self.ks.update(&allow)?;
        let moved = allow.connect.0 != self.allow.connect.0;
        self.allow = allow;
        // A guard built without a route (`with_parts`) stays without one.
        if moved {
            if let Some(old) = self.route.take() {
                let _ = old.remove();
                self.route = Some(RouteGuard::install(self.allow.connect.0)?);
            }
        }
        Ok(())
    }

    /// Every step runs even when an earlier one fails, because a skipped
    /// step leaves system state nothing else will clean up. `&mut self` so a
    /// failure leaves the guard with its owner, to be retried.
    pub fn lower(&mut self) -> Result<(), String> {
        let route = match self.route.take() {
            Some(r) => r.remove(),
            None => Ok(()),
        };
        let ks = self.ks.remove();
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
        Allowlist { connect: (Ipv4Addr::new(10, 0, 0, last), 443), allow_lan: true }
    }

    fn guard(fail_update: bool) -> (TunGuard, Arc<Mutex<Vec<String>>>) {
        let calls = Arc::new(Mutex::new(Vec::new()));
        let ks = Box::new(Fake { calls: calls.clone(), fail_update });
        (TunGuard::with_parts(ks, None, allow(1)), calls)
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
