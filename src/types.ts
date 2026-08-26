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
  starting: "Starting…",
  running: "Running",
  error: "Error",
};

export const STATE_SUBTITLE: Record<ProxyState, string> = {
  stopped: "Not running",
  starting: "Waiting for elevated launch",
  running: "Traffic is being spoofed",
  error: "Failed to start",
};

/** Feeds the `--orb` custom property on `.orb`. */
export const STATE_ORB: Record<ProxyState, string> = {
  stopped: "var(--color-st-stopped)",
  starting: "var(--color-st-starting)",
  running: "var(--color-st-running)",
  error: "var(--color-st-error)",
};

export function activeProfile(store: Store): Profile | undefined {
  return store.profiles.find((p) => p.id === store.active_id);
}
