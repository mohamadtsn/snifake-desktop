import type { PassthroughStatus } from "@/types";

/** Same as `validate::validate_interface`; `passthrough.fixtures.json` pins them. */
export const MAX_PASSTHROUGH = 8;

export function interfaceError(v: string): string | null {
  if (!/^[A-Za-z0-9_.-]{1,15}$/.test(v)) return `"${v}" is not an interface name.`;
  if (v === "snifake-tun0" || v === "lo") return `"${v}" cannot be a coexisting VPN.`;
  return null;
}

/** One sentence under each VPN. The absent cases say so in words. */
export function statusLine(
  s: PassthroughStatus | undefined,
  tunActive: boolean,
): { text: string; tone: "ok" | "warn" | "neutral" } {
  if (!tunActive || !s) return { text: "Routes and server are found and applied when TUN starts.", tone: "neutral" };
  if (!s.present) return { text: "Not up. Picked up within five seconds of appearing.", tone: "neutral" };
  if (s.problem) return { text: s.problem, tone: "warn" };
  const parts = [
    s.kind ?? "interface",
    ...s.endpoints.map((e) => `server ${e.ip}:${e.port}`),
    `${s.routes.length} ${s.routes.length === 1 ? "route" : "routes"} kept out of the tunnel`,
  ];
  return { text: parts.join(" · "), tone: "ok" };
}
