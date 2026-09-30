import { describe, expect, it } from "vitest";
import table from "./passthrough.fixtures.json";
import { interfaceError, statusLine } from "./passthrough";

describe("coexisting VPNs", () => {
  it("agrees with Rust on every interface name", () => {
    for (const c of table.names) expect(interfaceError(c.value) === null, c.value).toBe(c.ok);
  });

  it("says what was found, in words", () => {
    const s = {
      name: "priv", present: true, kind: "wireguard",
      endpoints: [{ ip: "37.191.85.82", port: 51820 }],
      routes: [{ dst: "10.200.0.0/16", table: "51820" }, { dst: "37.191.85.82", table: "51820" }],
      problem: null,
    };
    expect(statusLine(s, true)).toEqual({
      text: "wireguard · server 37.191.85.82:51820 · 2 routes kept out of the tunnel",
      tone: "ok",
    });
  });

  it("is honest about absence, problems and a stopped tunnel", () => {
    expect(statusLine(undefined, false).text).toMatch(/applied when TUN starts/);
    expect(statusLine({ name: "wg0", present: false, kind: null, endpoints: [], routes: [], problem: null }, true))
      .toEqual({ text: "Not up. Picked up within five seconds of appearing.", tone: "neutral" });
    expect(statusLine({ name: "wg0", present: true, kind: "wireguard", endpoints: [], routes: [], problem: "Install wireguard-tools so the server of wg0 can be found." }, true).tone)
      .toBe("warn");
  });
});
