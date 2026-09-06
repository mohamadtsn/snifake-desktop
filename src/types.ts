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

/**
 * The tunnel's five conditions. `holding` is the one the SNI stage
 * creates: the tunnel is up but the stage it dials is not, so traffic is
 * held rather than let out around it.
 */
export type TunnelState = "offline" | "starting" | "active" | "holding" | "fault";

export type Protocol = "vless" | "trojan";
export type TunnelMode = "tun" | "system_proxy" | "manual";
export type DefaultRoute = "proxy" | "direct";

/** Mirrors `tunnel::model::TunnelProfile`. No address or port: they come
 *  from the running SNI profile at generation time. */
export interface TunnelProfile {
  id: string;
  name: string;
  protocol: Protocol;
  credential: string;
  remote_host: string;
  path: string;
  sni: string;
  alpn: string[];
  fingerprint: string;
  allow_insecure: boolean;
}

/** Mirrors `tunnel::model::Routing`. */
export interface Routing {
  block: string[];
  bypass: string[];
  proxy: string[];
  raw: unknown | null;
  default_route: DefaultRoute;
  block_quic: boolean;
  allow_lan: boolean;
}

/** Mirrors `tunnel::model::TunnelStore`. */
export interface TunnelStore {
  tunnels: TunnelProfile[];
  active_id: string | null;
  mode: TunnelMode;
  proxy_host: string;
  proxy_port: number;
  routing: Routing;
}

export const TUNNEL_STATE_TEXT: Record<TunnelState, string> = {
  offline: "OFFLINE",
  starting: "STARTING",
  active: "ACTIVE",
  holding: "HOLD",
  fault: "FAULT",
};

export const TUNNEL_STATE_ACTION: Record<TunnelState, string> = {
  offline: "Start",
  starting: "Abort",
  active: "Stop",
  holding: "Stop",
  fault: "Retry",
};

/**
 * `holding` borrows amber from `starting`, and for the same reason: on
 * real equipment amber means "wait", not "broken". Green stays reserved
 * for `active`. See DESIGN.md §1.1.
 */
export const TUNNEL_STATE_COLOR: Record<TunnelState, string> = {
  offline: "var(--color-st-stopped)",
  starting: "var(--color-st-starting)",
  active: "var(--color-st-running)",
  holding: "var(--color-st-starting)",
  fault: "var(--color-st-error)",
};

export function activeTunnel(store: TunnelStore): TunnelProfile | undefined {
  return store.tunnels.find((t) => t.id === store.active_id);
}
