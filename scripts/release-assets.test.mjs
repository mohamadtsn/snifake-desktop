import { describe, expect, it } from "vitest";
import { platformOf, renamed, renames, rewriteManifest } from "./release-assets.mjs";

/** Every asset the v2.0.6 release actually carried. */
const ASSETS = [
  "latest.json",
  "Snifake-2.0.6-1.x86_64.rpm",
  "Snifake-2.0.6-1.x86_64.rpm.sig",
  "Snifake_2.0.6_aarch64.dmg",
  "Snifake_2.0.6_amd64.AppImage",
  "Snifake_2.0.6_amd64.AppImage.sig",
  "Snifake_2.0.6_amd64.deb",
  "Snifake_2.0.6_amd64.deb.sig",
  "Snifake_2.0.6_x64-setup.exe",
  "Snifake_2.0.6_x64-setup.exe.sig",
  "Snifake_2.0.6_x64.dmg",
  "Snifake_2.0.6_x64_en-US.msi",
  "Snifake_2.0.6_x64_en-US.msi.sig",
  "Snifake_aarch64.app.tar.gz",
  "Snifake_aarch64.app.tar.gz.sig",
  "Snifake_x64.app.tar.gz",
  "Snifake_x64.app.tar.gz.sig",
];

describe("naming", () => {
  it("names the platform in every installer, signatures included", () => {
    expect(Object.fromEntries(renames(ASSETS))).toEqual({
      "Snifake-2.0.6-1.x86_64.rpm": "Snifake-linux-2.0.6-1.x86_64.rpm",
      "Snifake-2.0.6-1.x86_64.rpm.sig": "Snifake-linux-2.0.6-1.x86_64.rpm.sig",
      "Snifake_2.0.6_aarch64.dmg": "Snifake_macos_2.0.6_aarch64.dmg",
      "Snifake_2.0.6_amd64.AppImage": "Snifake_linux_2.0.6_amd64.AppImage",
      "Snifake_2.0.6_amd64.AppImage.sig": "Snifake_linux_2.0.6_amd64.AppImage.sig",
      "Snifake_2.0.6_amd64.deb": "Snifake_linux_2.0.6_amd64.deb",
      "Snifake_2.0.6_amd64.deb.sig": "Snifake_linux_2.0.6_amd64.deb.sig",
      "Snifake_2.0.6_x64-setup.exe": "Snifake_windows_2.0.6_x64-setup.exe",
      "Snifake_2.0.6_x64-setup.exe.sig": "Snifake_windows_2.0.6_x64-setup.exe.sig",
      "Snifake_2.0.6_x64.dmg": "Snifake_macos_2.0.6_x64.dmg",
      "Snifake_2.0.6_x64_en-US.msi": "Snifake_windows_2.0.6_x64_en-US.msi",
      "Snifake_2.0.6_x64_en-US.msi.sig": "Snifake_windows_2.0.6_x64_en-US.msi.sig",
      "Snifake_aarch64.app.tar.gz": "Snifake_macos_aarch64.app.tar.gz",
      "Snifake_aarch64.app.tar.gz.sig": "Snifake_macos_aarch64.app.tar.gz.sig",
      "Snifake_x64.app.tar.gz": "Snifake_macos_x64.app.tar.gz",
      "Snifake_x64.app.tar.gz.sig": "Snifake_macos_x64.app.tar.gz.sig",
    });
  });

  it("leaves the manifest and anything it does not recognise alone", () => {
    expect(platformOf("latest.json")).toBeNull();
    expect(renamed("latest.json")).toBeNull();
    expect(renamed("CHANGELOG.md")).toBeNull();
    // No separator to insert at: better untouched than mangled.
    expect(renamed("Snifake.dmg")).toBeNull();
  });

  it("is idempotent, so re-running the job renames nothing twice", () => {
    const once = renames(ASSETS);
    expect(renames([...once.values()]).size).toBe(0);
  });

  it("reads .app.tar.gz as macOS rather than as a bare archive", () => {
    expect(platformOf("Snifake_aarch64.app.tar.gz")).toBe("macos");
  });
});

describe("the updater manifest", () => {
  const manifest = JSON.stringify({
    version: "2.0.6",
    platforms: {
      "linux-x86_64": {
        signature: "sig",
        url: "https://github.com/o/r/releases/download/v2.0.6/Snifake_2.0.6_amd64.AppImage",
      },
      "windows-x86_64-nsis": {
        signature: "sig",
        url: "https://github.com/o/r/releases/download/v2.0.6/Snifake_2.0.6_x64-setup.exe",
      },
      "unrenamed-platform": {
        signature: "sig",
        url: "https://github.com/o/r/releases/download/v2.0.6/something-else.zip",
      },
    },
  });

  it("follows every renamed installer to its new URL", () => {
    const after = JSON.parse(rewriteManifest(manifest, renames(ASSETS)));
    expect(after.platforms["linux-x86_64"].url).toBe(
      "https://github.com/o/r/releases/download/v2.0.6/Snifake_linux_2.0.6_amd64.AppImage",
    );
    expect(after.platforms["windows-x86_64-nsis"].url).toBe(
      "https://github.com/o/r/releases/download/v2.0.6/Snifake_windows_2.0.6_x64-setup.exe",
    );
  });

  it("leaves a URL nobody renamed exactly as it was", () => {
    const after = JSON.parse(rewriteManifest(manifest, renames(ASSETS)));
    expect(after.platforms["unrenamed-platform"].url).toBe(
      "https://github.com/o/r/releases/download/v2.0.6/something-else.zip",
    );
  });

  it("keeps the signatures untouched — they are what the updater verifies", () => {
    const before = JSON.parse(manifest);
    const after = JSON.parse(rewriteManifest(manifest, renames(ASSETS)));
    for (const key of Object.keys(before.platforms)) {
      expect(after.platforms[key].signature).toBe(before.platforms[key].signature);
    }
    expect(after.version).toBe(before.version);
  });

  /** Every URL in a real manifest must end at an asset that exists. */
  it("leaves no URL pointing at a name that no longer exists", () => {
    const map = renames(ASSETS);
    const after = JSON.parse(rewriteManifest(manifest, map));
    const live = new Set(ASSETS.map((name) => map.get(name) ?? name));
    for (const [key, platform] of Object.entries(after.platforms)) {
      const file = platform.url.slice(platform.url.lastIndexOf("/") + 1);
      if (key === "unrenamed-platform") continue;
      expect(live.has(file), `${key} points at ${file}`).toBe(true);
    }
  });
});
