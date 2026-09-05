// Puts the platform in the name of every released file.
//
// Tauri's bundlers name their output after the product, the version and the
// architecture — `Snifake_2.0.6_x64-setup.exe`, `Snifake_2.0.6_amd64.deb`,
// `Snifake_2.0.6_aarch64.dmg`. On a release page that is a wall of names in
// which the platform is implied by an extension, so this inserts it:
// `Snifake_windows_2.0.6_x64-setup.exe`. The slug goes right after the
// product name rather than anywhere else, because that is the one position
// that works for every bundler's convention and sorts the platforms into
// groups.
//
// The delicate part is `latest.json`: its URLs point straight at these
// installers, so a rename that does not rewrite the manifest breaks the
// in-app updater for everyone already running the app. Renaming and
// rewriting therefore happen in one pass, from one map, in this one file.
//
// Run by the release workflow after every build job has uploaded:
//
//   node scripts/release-assets.mjs <tag>
//
// Idempotent — a re-run finds the slugs already in place and does nothing.

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Extension → platform. Ordered: `.app.tar.gz` must beat `.gz`. */
const PLATFORMS = [
  [".app.tar.gz", "macos"],
  [".dmg", "macos"],
  [".exe", "windows"],
  [".msi", "windows"],
  [".AppImage", "linux"],
  [".deb", "linux"],
  [".rpm", "linux"],
];

/** The platform an asset belongs to, or null if it is not an installer. */
export function platformOf(name) {
  const base = name.endsWith(".sig") ? name.slice(0, -4) : name;
  for (const [ext, platform] of PLATFORMS) {
    if (base.endsWith(ext)) return platform;
  }
  return null;
}

/**
 * The name an asset should have, or null to leave it alone.
 *
 * The slug is inserted after the product name, reusing whichever separator
 * the bundler chose there — `_` for most, `-` for rpm — so the result still
 * reads like a name that bundler would have produced.
 */
export function renamed(name) {
  const platform = platformOf(name);
  if (!platform) return null;
  const at = name.search(/[_-]/);
  if (at < 0) return null;
  const separator = name[at];
  if (name.startsWith(`${name.slice(0, at)}${separator}${platform}${separator}`)) {
    return null; // already carries its slug
  }
  return `${name.slice(0, at)}${separator}${platform}${name.slice(at)}`;
}

/** Every rename that applies to a list of asset names, as old → new. */
export function renames(names) {
  const map = new Map();
  for (const name of names) {
    const next = renamed(name);
    if (next) map.set(name, next);
  }
  return map;
}

/**
 * The updater manifest with every renamed URL followed to its new name.
 *
 * Takes the manifest as text and rewrites the file name at the end of each
 * URL, so a URL naming an asset nobody renamed is left byte-identical.
 */
export function rewriteManifest(text, map) {
  const manifest = JSON.parse(text);
  for (const platform of Object.values(manifest.platforms ?? {})) {
    const at = platform.url.lastIndexOf("/") + 1;
    const next = map.get(platform.url.slice(at));
    if (next) platform.url = platform.url.slice(0, at) + next;
  }
  return JSON.stringify(manifest, null, 2);
}

function gh(args, options = {}) {
  return execFileSync("gh", args, { encoding: "utf8", ...options });
}

function release(repo, tag) {
  // Not `releases/tags/<tag>`: that endpoint cannot see a draft, and every
  // release starts as one.
  const all = JSON.parse(gh(["api", `repos/${repo}/releases`, "--paginate"]));
  const found = all.find((r) => r.tag_name === tag);
  if (!found) throw new Error(`no release found for ${tag}`);
  return found;
}

function main() {
  const args = process.argv.slice(2);
  const dry = args.includes("--dry-run");
  const tag = args.find((a) => !a.startsWith("--"));
  const repo = process.env.GITHUB_REPOSITORY;
  if (!tag || !repo) {
    console.error(
      "usage: GITHUB_REPOSITORY=owner/repo node release-assets.mjs <tag> [--dry-run]",
    );
    process.exit(2);
  }

  const { assets } = release(repo, tag);
  const map = renames(assets.map((a) => a.name));
  if (map.size === 0) {
    console.log("every asset already names its platform; nothing to do");
    return;
  }
  if (dry) {
    for (const [from, to] of map) console.log(`${from} → ${to}`);
    return;
  }

  // Renames first: the manifest must never point at a name that does not
  // exist yet, and an interrupted run is then a manifest that is merely
  // stale rather than one that is wrong.
  for (const asset of assets) {
    const next = map.get(asset.name);
    if (!next) continue;
    gh(["api", "-X", "PATCH", `repos/${repo}/releases/assets/${asset.id}`, "-f", `name=${next}`], {
      stdio: ["ignore", "ignore", "inherit"],
    });
    console.log(`${asset.name} → ${next}`);
  }

  const manifest = assets.find((a) => a.name === "latest.json");
  if (!manifest) {
    console.log("no latest.json on this release; nothing to rewrite");
    return;
  }
  // `Accept: octet-stream` on the asset endpoint follows the redirect and
  // hands back the file itself, which is the only way to read an asset of a
  // release that is still a draft.
  const text = gh([
    "api",
    `repos/${repo}/releases/assets/${manifest.id}`,
    "-H",
    "Accept: application/octet-stream",
  ]);
  const path = join(mkdtempSync(join(tmpdir(), "snifake-release-")), "latest.json");
  writeFileSync(path, rewriteManifest(text, map));
  gh(["release", "upload", tag, path, "--clobber"], { stdio: "inherit" });
  console.log("latest.json rewritten to match");
}

if (import.meta.url === `file://${process.argv[1]}`) main();
