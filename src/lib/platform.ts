/**
 * Where the window controls sit.
 *
 * Read from the user agent rather than through `@tauri-apps/plugin-os` on
 * purpose: it is one boolean, it is needed during the first render, and a
 * plugin round trip would make the title bar's control cluster jump from one
 * side to the other after paint.
 *
 * `navigator.platform` is deprecated but is still what both WebKitGTK and
 * WebView2 report accurately, and `userAgentData` is Chromium-only. The
 * userAgent string is the fallback for anything that has dropped it.
 */
export function isMac(): boolean {
  const nav = globalThis.navigator;
  if (!nav) return false;
  return /Mac|iPhone|iPad/.test(nav.platform || nav.userAgent || "");
}
