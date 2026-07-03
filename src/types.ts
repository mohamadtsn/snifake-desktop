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
  stopped: "Proxy is not running",
  starting: "Waiting for elevated launch…",
  running: "Proxy is active",
  error: "Proxy failed to start",
};

export const STATE_DOT_CLASS: Record<ProxyState, string> = {
  stopped: "bg-text-dim",
  starting: "bg-warning",
  running: "bg-success",
  error: "bg-danger",
};