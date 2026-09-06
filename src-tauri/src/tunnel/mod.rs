//! The V2Ray tunnel: the optional second stage that runs in front of the
//! SNI listener. Everything config-shaped lives here, in the
//! *unprivileged* half — the engine receives finished JSON and never
//! interprets it.

pub mod core;
pub mod generate;
pub mod import;
pub mod model;
pub mod rules;
