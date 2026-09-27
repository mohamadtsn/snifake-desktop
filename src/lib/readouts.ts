import type { Profile, Store, TunnelProfile } from "@/types";

/** Mirrors `tunnel::download::CoreStatus`. */
export interface CoreStatus {
  installed: boolean;
  version: string;
  url: string;
  path: string;
  sha256: string | null;
}

/**
 * Every readout in the workbench is one of these.
 *
 * They exist as functions rather than inline JSX because the interesting
 * half is the *absent* case. `DESIGN.md` promises that the interface never
 * shows a reading it does not have, and the only way that promise is
 * testable is if the wording for "nothing here" lives somewhere a test can
 * reach. Each of these is a slot the mockups filled with a number nothing
 * produces; the comment on each one names which.
 */

const ABSENT_PROFILE = "no profile";
const ABSENT_TUNNEL = "no tunnel";

/**
 * Keeps both ends, because in a hostname, a path or a profile name the ends
 * are where the meaning is: `main-…-relay.net` still identifies the thing,
 * `main-office-serv…` does not distinguish it from its neighbour.
 *
 * Never returns more than `max` characters, which is the point: these
 * strings land in the title bar and the footer beside a tab bar that has to
 * stay centred, and the values are chosen by the user.
 */
export function middleTruncate(value: string, max: number): string {
  if (value.length <= max) return value;
  if (max <= 1) return "…".slice(0, max);
  const keep = max - 1;
  const head = Math.ceil(keep / 2);
  const tail = keep - head;
  return `${value.slice(0, head)}…${tail > 0 ? value.slice(-tail) : ""}`;
}

/** The slot the mockup filled with `-58 dBm` and a four-bar signal meter. */
export function listenAddress(profile: Profile | undefined): string {
  if (!profile) return ABSENT_PROFILE;
  return `${profile.LISTEN_HOST}:${profile.LISTEN_PORT}`;
}

export function upstreamAddress(profile: Profile | undefined): string {
  if (!profile) return ABSENT_PROFILE;
  return `${profile.CONNECT_IP}:${profile.CONNECT_PORT}`;
}

/**
 * The slot the mockup filled with an RTT sparkline and `RTT 42 ms`.
 *
 * The protocol set is closed - `vless`/`trojan` over `ws` with `tls`, see
 * CLAUDE.md - so transport and security are constants here rather than
 * fields. That is a fact about what this application supports, not a
 * measurement, which is exactly why it is allowed to be on the face.
 */
export function tunnelSignature(tunnel: TunnelProfile | undefined): string {
  if (!tunnel) return ABSENT_TUNNEL;
  return `${tunnel.protocol.toUpperCase()} · WS · TLS`;
}

/** The slot the mockup filled with `ENC: AES-128-GCM`. The cipher is chosen
 *  by the core and never reported; the SNI is ours and is stored. */
export function tunnelSni(tunnel: TunnelProfile | undefined): string {
  if (!tunnel) return ABSENT_TUNNEL;
  return tunnel.sni;
}

/**
 * The slot the mockup filled with `BUS: 0x88F2 // 1,420 pkts/s`.
 *
 * Also the answer to an empty profile store, which the old interface
 * handled by returning `null` from `App` and showing a blank window.
 */
export function activeRoute(store: Store): string {
  const profile = store.profiles.find((p) => p.id === store.active_id);
  if (!profile) return "no profile configured";
  return `${middleTruncate(profile.name, 28)} → ${upstreamAddress(profile)}`;
}

/** The slot the mockup filled with `BUFFER: 1.4 MB / 16 MB`. There is no
 *  such buffer; there is a 500-line ring, and this is how full it is. */
export function logBufferLabel(count: number): string {
  if (count <= 0) return "log empty";
  return `${count} ${count === 1 ? "line" : "lines"}`;
}

/** A footer endpoint slot. The slot is fixed; what fills it is not. */
export function endpointLabel(address: string | null): string {
  return address ?? "—";
}
