// src/lib/readouts.test.ts
import { describe, expect, it } from "vitest";
import {
  activeRoute,
  endpointLabel,
  exitReadout,
  tunnelInbound,
  listenAddress,
  logBufferLabel,
  middleTruncate,
  tunnelSignature,
  tunnelSni,
  upstreamAddress,
} from "@/lib/readouts";
import type { Profile, Store, TunnelProfile, TunnelStore } from "@/types";

const profile: Profile = {
  id: "p1",
  name: "Main Office Server",
  LISTEN_HOST: "127.0.0.1",
  LISTEN_PORT: 10808,
  CONNECT_IP: "185.199.108.153",
  CONNECT_PORT: 443,
  FAKE_SNI: "assets.github.com",
};

const tunnel: TunnelProfile = {
  id: "t1",
  name: "Edge Relay",
  protocol: "vless",
  credential: "d3b07384-d113-4632-a227-2c164a6f2299",
  remote_host: "main-tunnel.vless.net",
  path: "/vless-ws",
  sni: "main-tunnel.vless.net",
  alpn: ["h2", "http/1.1"],
  fingerprint: "chrome",
  allow_insecure: false,
};

describe("middleTruncate", () => {
  it("leaves a short string alone", () => {
    expect(middleTruncate("short", 20)).toBe("short");
  });

  it("keeps both ends of an over-long string", () => {
    const out = middleTruncate("a-very-long-profile-name-that-will-not-fit", 20);
    expect(out).toHaveLength(20);
    expect(out.startsWith("a-very")).toBe(true);
    expect(out.endsWith("t-fit")).toBe(true);
    expect(out).toContain("…");
  });

  it("never returns more than max characters", () => {
    expect(middleTruncate("x".repeat(200), 12)).toHaveLength(12);
  });
});

describe("address readouts", () => {
  it("renders listen and upstream as host:port", () => {
    expect(listenAddress(profile)).toBe("127.0.0.1:10808");
    expect(upstreamAddress(profile)).toBe("185.199.108.153:443");
  });

  it("says so when there is no profile at all", () => {
    expect(listenAddress(undefined)).toBe("no profile");
    expect(upstreamAddress(undefined)).toBe("no profile");
  });
});

describe("tunnel readouts", () => {
  it("renders the protocol signature from the real fields", () => {
    expect(tunnelSignature(tunnel)).toBe("VLESS · WS · TLS");
  });

  it("renders the tunnel SNI", () => {
    expect(tunnelSni(tunnel)).toBe("main-tunnel.vless.net");
  });

  it("says so when no tunnel is configured", () => {
    expect(tunnelSignature(undefined)).toBe("no tunnel");
    expect(tunnelSni(undefined)).toBe("no tunnel");
  });
});

describe("activeRoute", () => {
  const store: Store = { profiles: [profile], active_id: "p1" };

  it("names the active profile and where it points", () => {
    expect(activeRoute(store)).toBe("Main Office Server → 185.199.108.153:443");
  });

  it("handles an empty store without inventing a profile", () => {
    expect(activeRoute({ profiles: [], active_id: null })).toBe("no profile configured");
  });

  it("handles an active_id that matches nothing", () => {
    expect(activeRoute({ profiles: [profile], active_id: "gone" })).toBe(
      "no profile configured",
    );
  });

  it("truncates a long name rather than widening the footer", () => {
    const long = { ...profile, name: "x".repeat(80) };
    const out = activeRoute({ profiles: [long], active_id: "p1" });
    expect(out.length).toBeLessThanOrEqual(64);
  });
});

describe("logBufferLabel", () => {
  it("counts lines", () => {
    expect(logBufferLabel(42)).toBe("42 lines");
  });

  it("uses the singular for one", () => {
    expect(logBufferLabel(1)).toBe("1 line");
  });

  it("says empty rather than showing a zero", () => {
    expect(logBufferLabel(0)).toBe("log empty");
  });
});

// Review Focus 4: an over-long value dropped into a fixed-width slot. The
// footer and the title bar are the two places a user-chosen string meets a
// centred tab bar it must not be able to push.
describe("over-long values in fixed slots", () => {
  it("truncates a 200-character hostname to the slot width", () => {
    const wide = { ...profile, CONNECT_IP: "h".repeat(200) };
    expect(middleTruncate(upstreamAddress(wide), 32)).toHaveLength(32);
  });

  it("keeps the port visible when the host is what is too long", () => {
    const wide = { ...profile, CONNECT_IP: "h".repeat(60) };
    expect(middleTruncate(upstreamAddress(wide), 24).endsWith(":443")).toBe(true);
  });

  it("degrades to a bare ellipsis rather than throwing at max 1", () => {
    expect(middleTruncate("abcdef", 1)).toBe("…");
  });

  it("returns an empty string rather than throwing at max 0", () => {
    expect(middleTruncate("abcdef", 0)).toBe("");
  });
});

// Review Focus 5: no tunnel, or a tunnel with no core. Every tunnel-derived
// readout has to produce its documented absent string, never `undefined`
// leaking into the DOM as the word "undefined".
describe("absent second stage", () => {
  it("produces no undefined or NaN from any readout when nothing is configured", () => {
    const outs = [
      listenAddress(undefined),
      upstreamAddress(undefined),
      tunnelSignature(undefined),
      tunnelSni(undefined),
      activeRoute({ profiles: [], active_id: null }),
      logBufferLabel(0),
    ];
    for (const out of outs) {
      expect(typeof out).toBe("string");
      expect(out).not.toContain("undefined");
      expect(out).not.toContain("NaN");
      expect(out.length).toBeGreaterThan(0);
    }
  });

  it("names a trojan tunnel by its own protocol", () => {
    expect(tunnelSignature({ ...tunnel, protocol: "trojan" })).toBe("TROJAN · WS · TLS");
  });

});

describe("endpointLabel", () => {
  it("says the address when there is one", () => {
    expect(endpointLabel("127.0.0.1:2080")).toBe("127.0.0.1:2080");
  });

  it("says a dash when nothing is configured", () => {
    // The footer slot exists whether or not a stage does. An empty string
    // would collapse the row; a dash keeps the layout and states the
    // absence.
    expect(endpointLabel(null)).toBe("—");
  });
});

describe("tunnelInbound", () => {
  const base: Omit<TunnelStore, "mode"> = {
    tunnels: [],
    active_id: null,
    proxy_host: "127.0.0.1",
    proxy_port: 2080,
    routing: { block: [], bypass: [], proxy: [], raw: null, default_route: "proxy", block_quic: true, allow_lan: true, kill_switch: true, passthrough: [], rule_sets: [] },
  };

  it("names the port the proxy modes open", () => {
    expect(tunnelInbound({ ...base, mode: "manual" })).toBe("127.0.0.1:2080");
    expect(tunnelInbound({ ...base, mode: "system_proxy" })).toBe("127.0.0.1:2080");
  });

  it("does not claim a port in TUN, which opens none", () => {
    expect(tunnelInbound({ ...base, mode: "tun" })).toBe("virtual interface");
  });

  it("has nothing to say before the store loads", () => {
    expect(tunnelInbound(null)).toBeNull();
  });
});

describe("exitReadout", () => {
  const info = { ip: "185.1.2.3", city: "Frankfurt am Main", region: "Hesse", country: "DE", org: "AS24940 Hetzner Online GmbH" };
  it("says nothing when off", () => expect(exitReadout({ status: "off" })).toBeNull());
  it("says it is checking", () => expect(exitReadout({ status: "checking" })?.primary).toBe("checking exit…"));
  it("shows address, place and network without the AS number", () =>
    expect(exitReadout({ status: "ok", info })).toEqual({
      primary: "185.1.2.3", secondary: "Frankfurt am Main, DE · Hetzner Online GmbH",
    }));
  it("admits it does not know", () =>
    expect(exitReadout({ status: "failed", reason: "x" })).toEqual({ primary: "exit unknown", secondary: "x" }));
});

it("TUN's footer slot shows the exit once known", () => {
  const t = { mode: "tun", proxy_host: "127.0.0.1", proxy_port: 2080 } as never;
  expect(tunnelInbound(t)).toBe("virtual interface");
  expect(tunnelInbound(t, { ip: "185.1.2.3", city: "", region: "", country: "DE", org: "" })).toBe("exit 185.1.2.3 · DE");
});
