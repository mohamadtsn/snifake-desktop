#!/usr/bin/env node
// Single source of truth for the release version.
//
// tauri.conf.json already reads `version` from package.json, but the two
// Cargo manifests carry their own copies and there is nothing that keeps
// them in step — which is exactly how package.json ended up on 1.1.3 while
// Cargo.toml sat on 1.1.0. This writes all three at once.
//
//   node scripts/set-version.mjs 2.1.0     set an exact version
//   node scripts/set-version.mjs --check   verify the three agree (CI)
import { readFileSync, writeFileSync } from "node:fs";

const PKG = "package.json";
const CRATES = ["src-tauri/Cargo.toml", "src-tauri/engine/Cargo.toml"];

const read = (f) => readFileSync(f, "utf8");
// Only the [package] version — the first `version = ` in the file, never a
// dependency's.
const crateVersion = (t) => t.match(/^version = "(.+?)"$/m)?.[1];

const arg = process.argv[2];

if (arg === "--check") {
  const want = JSON.parse(read(PKG)).version;
  const bad = CRATES.filter((f) => crateVersion(read(f)) !== want);
  if (bad.length) {
    console.error(`version mismatch: ${PKG} is ${want}, but ${bad.join(", ")} differ`);
    process.exit(1);
  }
  console.log(`version ${want} consistent across ${[PKG, ...CRATES].length} manifests`);
  process.exit(0);
}

if (!/^\d+\.\d+\.\d+$/.test(arg ?? "")) {
  console.error("usage: node scripts/set-version.mjs <major.minor.patch> | --check");
  process.exit(1);
}

const pkg = JSON.parse(read(PKG));
pkg.version = arg;
writeFileSync(PKG, JSON.stringify(pkg, null, 2) + "\n");
for (const f of CRATES) {
  writeFileSync(f, read(f).replace(/^version = ".+?"$/m, `version = "${arg}"`));
}
console.log(`set version ${arg}; now: git commit -am "chore: 🔖 v${arg}" && git tag v${arg}`);
