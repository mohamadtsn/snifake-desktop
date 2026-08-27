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

export const STATE_TEXT: Record<ProxyState, string> = {
  stopped: "Stopped",
  starting: "Starting",
  running: "Running",
  error: "Error",
};

/** The subtitle names the action the disc performs, not the state again. */
export const STATE_ACTION: Record<ProxyState, string> = {
  stopped: "Tap to start",
  starting: "Tap to cancel",
  running: "Tap to stop",
  error: "Tap to retry",
};

/** Feeds the `--disc` custom property on `.disc`. */
export const STATE_COLOR: Record<ProxyState, string> = {
  stopped: "var(--color-st-stopped)",
  starting: "var(--color-st-starting)",
  running: "var(--color-st-running)",
  error: "var(--color-st-error)",
};

export function activeProfile(store: Store): Profile | undefined {
  return store.profiles.find((p) => p.id === store.active_id);
}
