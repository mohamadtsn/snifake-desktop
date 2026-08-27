export type ProxyState = "stopped" | "starting" | "running" | "error";

/** Mirrors `sni_fake_engine::proto::Profile`. */
export interface Profile {
  id: string;
  name: string;
  LISTEN_HOST: string;
  LISTEN_PORT: number;
  CONNECT_IP: string;
  CONNECT_PORT: number;
  FAKE_SNI: string;
}

/** Mirrors `profiles::Store`. */
export interface Store {
  profiles: Profile[];
  active_id: string | null;
}

/**
 * Instrument vocabulary, not app vocabulary. A console reports a condition
 * ("ACTIVE") where an app reports an activity ("Running"); the difference
 * matters because the reading is meant to be scanned, not read.
 */
export const STATE_TEXT: Record<ProxyState, string> = {
  stopped: "OFFLINE",
  starting: "STARTING",
  running: "ACTIVE",
  error: "FAULT",
};

/** The label on the switch names what pressing it does, never the state. */
export const STATE_ACTION: Record<ProxyState, string> = {
  stopped: "Start",
  starting: "Abort",
  running: "Stop",
  error: "Retry",
};

export const STATE_COLOR: Record<ProxyState, string> = {
  stopped: "var(--color-st-stopped)",
  starting: "var(--color-st-starting)",
  running: "var(--color-st-running)",
  error: "var(--color-st-error)",
};

export function activeProfile(store: Store): Profile | undefined {
  return store.profiles.find((p) => p.id === store.active_id);
}

/** `h:mm:ss` from a millisecond duration. Hours are uncapped on purpose. */
export function formatUptime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}
