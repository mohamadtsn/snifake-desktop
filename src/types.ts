export type ProxyState = "stopped" | "starting" | "running" | "error";

export interface Config {
  LISTEN_HOST: string;
  LISTEN_PORT: number;
  CONNECT_IP: string;
  CONNECT_PORT: number;
  FAKE_SNI: string;
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