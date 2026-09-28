//! Finding a system program as root.
//!
//! By absolute path, never through `PATH`: this process is root, and a
//! `PATH` lookup would run whatever an earlier directory happens to hold.
//! `pkexec` sanitises the environment anyway, so relying on it would also
//! be relying on a detail of the elevation method.

use std::path::{Path, PathBuf};

const DIRS: [&str; 4] = ["/usr/sbin", "/sbin", "/usr/bin", "/bin"];

pub fn find(name: &str) -> Option<PathBuf> {
    find_in(name, &DIRS)
}

pub fn find_in(name: &str, dirs: &[&str]) -> Option<PathBuf> {
    dirs.iter()
        .map(|d| Path::new(d).join(name))
        .find(|p| p.is_file())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tempdir(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("snifake-sysbin-{tag}-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn the_first_directory_that_holds_it_wins() {
        let a = tempdir("a");
        let b = tempdir("b");
        std::fs::write(b.join("tool"), b"").unwrap();
        std::fs::write(a.join("tool"), b"").unwrap();
        let found = find_in("tool", &[a.to_str().unwrap(), b.to_str().unwrap()]);
        assert_eq!(found, Some(a.join("tool")));
    }

    #[test]
    fn a_program_that_is_nowhere_is_none() {
        assert_eq!(find("snifake-no-such-program"), None);
    }

    #[test]
    fn a_directory_of_that_name_is_not_a_program() {
        let a = tempdir("dir");
        std::fs::create_dir_all(a.join("tool")).unwrap();
        assert_eq!(find_in("tool", &[a.to_str().unwrap()]), None);
    }
}
