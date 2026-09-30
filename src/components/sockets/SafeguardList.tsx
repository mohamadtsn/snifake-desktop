import { GroupedList } from "@/components/ui/GroupedList";
import { Toggle } from "@/components/ui/Toggle";
import type { Routing } from "@/types";

/**
 * The four safeguards, and they live only here.
 *
 * The mockups draw the first three switches on Preferences > Network as
 * well. They are one piece of state (`Routing.default_route`, `.block_quic`,
 * `.allow_lan`), and two places to change one setting is two places to
 * disagree about it. They belong beside the mode cards, which are what give
 * them meaning.
 */
export function SafeguardList({
  routing,
  onChange,
}: {
  routing: Routing;
  onChange: (patch: Partial<Routing>) => void;
}) {
  return (
    <section>
      <h2 className="mb-2 px-[2px] text-note font-semibold tracking-[0.55px] text-t2 uppercase">
        Packet intercept safeguards
      </h2>
      <GroupedList>
        <GroupedList.Row
          icon="sync_alt"
          on={routing.default_route === "proxy"}
          title="Default route through tunnel"
          subtitle="Unclassified traffic goes to the tunnel instead of out directly."
          control={
            <Toggle
              checked={routing.default_route === "proxy"}
              onChange={(on) => onChange({ default_route: on ? "proxy" : "direct" })}
              aria-label="Default route through tunnel"
            />
          }
        />
        <GroupedList.Row
          icon="block"
          on={routing.block_quic}
          title="Block QUIC (UDP 443)"
          subtitle="Chromium and iOS fall back to TCP rather than leaking past the tunnel over UDP."
          control={
            <Toggle
              checked={routing.block_quic}
              onChange={(on) => onChange({ block_quic: on })}
              aria-label="Block QUIC on UDP 443"
            />
          }
        />
        <GroupedList.Row
          icon="devices"
          on={routing.allow_lan}
          title="Allow local network (LAN bypass)"
          subtitle="Keeps printers, AirPlay and everything on 192.168.0.0/16 reachable."
          control={
            <Toggle
              checked={routing.allow_lan}
              onChange={(on) => onChange({ allow_lan: on })}
              aria-label="Allow local network bypass"
            />
          }
        />
        <GroupedList.Row
          icon="shield"
          on={routing.kill_switch}
          title="Kill switch (TUN)"
          subtitle={
            routing.kill_switch
              ? "If the tunnel fails, traffic is blocked. VPNs listed under Coexisting VPNs still pass."
              : "Off: anything the TUN does not carry leaves directly, and a failed tunnel can leak."
          }
          control={
            <Toggle
              checked={routing.kill_switch}
              onChange={(on) => onChange({ kill_switch: on })}
              aria-label="Kill switch in TUN mode"
            />
          }
        />
      </GroupedList>
    </section>
  );
}
