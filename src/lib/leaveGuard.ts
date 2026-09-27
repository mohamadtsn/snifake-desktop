/**
 * Whether leaving a tab has to be confirmed.
 *
 * One function rather than a condition in the tab handler, because the
 * same decision is made from three places - the tab bar, the window's
 * close glyph and the tray's Exit - and three copies of it is three
 * chances for one of them to throw a user's rules away silently.
 */
export type Leave = { kind: "go" } | { kind: "confirm"; to: string };

/** The only tab that owns an unsaved draft. */
const GUARDED = "sockets";

export function leaveDecision(dirty: boolean, from: string, to: string): Leave {
  if (!dirty) return { kind: "go" };
  if (from !== GUARDED) return { kind: "go" };
  // Pressing the tab you are on is not leaving it.
  if (from === to) return { kind: "go" };
  return { kind: "confirm", to };
}
