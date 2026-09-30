/**
 * The six frontend-owned preferences. Not engine configuration: none of
 * these reaches the privileged process, and two of them (`launchAtLogin`,
 * `colorizeTray`) are mirrored into Rust by whoever changes them.
 *
 * `proxy_host` and `proxy_port` are deliberately *not* here. They are part
 * of `TunnelStore` and go through `save_routing`, because the engine needs
 * them and a second copy in browser storage would eventually disagree with
 * the one the tunnel is actually listening on.
 */
export interface Prefs {
  /** The close glyph hides to the tray instead of asking to quit. */
  closeToTray: boolean;
  /** The tray icon carries the state-coloured badge. */
  colorizeTray: boolean;
  /** The one-per-launch update check runs at all. */
  silentUpdateChecks: boolean;
  launchAtLogin: boolean;
  /** Per-packet engine logging, the `set_verbose` flag. */
  verbose: boolean;
  /** Ask ipinfo.io, through the tunnel, where it comes out. */
  exitProbe: boolean;
}

/** Today's behaviour, so an install that has never opened Preferences
 *  behaves exactly as it did before Preferences existed. */
export const DEFAULT_PREFS: Prefs = {
  closeToTray: true,
  colorizeTray: true,
  silentUpdateChecks: true,
  launchAtLogin: false,
  verbose: false,
  exitProbe: true,
};

const KEY = "snifake.prefs";

/**
 * The storage is a parameter, not an import, for two reasons. It makes the
 * store testable under Vitest's `node` environment, which has no
 * `localStorage` at all; and it makes a *throwing* `localStorage` — a
 * private window, blocked site data, a WebKitGTK build with storage
 * disabled — an ordinary code path rather than an exception that takes the
 * window down on mount.
 */
interface Storageish {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): Storageish | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // Reaching for localStorage is itself what throws when site data is
    // blocked; the property access, not the call.
    return null;
  }
}

/**
 * Never throws, and never returns a partial object. Every key is either a
 * stored boolean or its default, so no caller has to ask whether a
 * preference is present. A preference the user cannot even see is not
 * worth crashing a window over.
 */
export function loadPrefs(storage: Storageish | null = defaultStorage()): Prefs {
  let raw: string | null = null;
  try {
    raw = storage?.getItem(KEY) ?? null;
  } catch {
    return { ...DEFAULT_PREFS };
  }
  if (!raw) return { ...DEFAULT_PREFS };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_PREFS };
  }
  if (typeof parsed !== "object" || parsed === null) return { ...DEFAULT_PREFS };

  // Per key rather than wholesale, so a stored document written by an older
  // version - or hand-edited, or half-overwritten - contributes the keys it
  // got right and nothing else.
  const out = { ...DEFAULT_PREFS };
  for (const key of Object.keys(DEFAULT_PREFS) as (keyof Prefs)[]) {
    const value = (parsed as Record<string, unknown>)[key];
    if (typeof value === "boolean") out[key] = value;
  }
  return out;
}

export function savePrefs(
  prefs: Prefs,
  storage: Storageish | null = defaultStorage(),
): void {
  try {
    storage?.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Nothing to do, and nothing to tell the user: the setting still holds
    // for this session, it just will not survive a restart. Surfacing that
    // as an error would make a working application look broken.
  }
}
