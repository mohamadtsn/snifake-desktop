import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { GroupedList } from "@/components/ui/GroupedList";
import { Icon } from "@/components/ui/Icon";
import { Toggle } from "@/components/ui/Toggle";
import { FIELD_INPUT } from "@/components/ui/FieldRow";
import type { TunnelStore } from "@/types";
import { Section } from "./Section";

const LAN = "0.0.0.0";
const LOOPBACK = "127.0.0.1";

/**
 * Two settings, and only two.
 *
 * The mockup also draws a `TRAFFIC INTERCEPTION POLICY` section here with
 * `Default route through tunnel`, `Block QUIC` and `Allow local network` in
 * it. Those are one piece of state with the three on the Sockets tab, and
 * they live there, beside the mode cards that give them meaning (spec 4.4).
 * `Strict Kill Switch` is not in the `Routing` model at all.
 *
 * These two are not preferences either: they are part of `TunnelStore` and
 * go through `save_routing`, because the engine needs them and a second copy
 * in browser storage would eventually disagree with the port the tunnel is
 * actually listening on.
 */
export function NetworkTab({
  store,
  onSave,
  saving,
}: {
  store: TunnelStore | null;
  onSave: (patch: { proxy_host: string; proxy_port: number }) => void;
  saving: boolean;
}) {
  const [port, setPort] = useState(String(store?.proxy_port ?? ""));

  useEffect(() => {
    setPort(String(store?.proxy_port ?? ""));
  }, [store?.proxy_port]);

  if (!store) {
    return <p className="text-body text-t2">Loading the tunnel configuration.</p>;
  }

  const parsed = Number(port);
  const portValid = /^\d{1,5}$/.test(port) && parsed >= 1 && parsed <= 65535;
  const portDirty = portValid && parsed !== store.proxy_port;

  return (
    <Section title="Network interfaces and routing">
      <GroupedList>
        <GroupedList.Row
          icon="wifi_tethering"
          title="Allow connection from LAN"
          subtitle={`Other devices on the local network can use the proxy. Binds to ${LAN} instead of ${LOOPBACK}.`}
          control={
            <Toggle
              checked={store.proxy_host === LAN}
              onChange={(on) =>
                onSave({ proxy_host: on ? LAN : LOOPBACK, proxy_port: store.proxy_port })
              }
              disabled={saving}
              aria-label="Allow connections from the local network"
            />
          }
        />
        <GroupedList.Row
          icon="settings_ethernet"
          title="Local SOCKS5 proxy port"
          badge={<Badge>TCP / UDP</Badge>}
          subtitle={`The tunnel listens on ${store.proxy_host}:${store.proxy_port}.`}
          control={
            <span className="flex items-center gap-2">
              {/* Wrapped rather than given a width class: FIELD_INPUT
                  carries `w-full`, and two width utilities on one element
                  are settled by stylesheet order, not by the class string. */}
              <span className="block w-[86px]">
                <input
                  value={port}
                  onChange={(e) => setPort(e.target.value.replace(/\D/g, "").slice(0, 5))}
                  dir="ltr"
                  inputMode="numeric"
                  aria-label="Local SOCKS5 proxy port"
                  aria-invalid={port !== "" && !portValid ? true : undefined}
                  className={`${FIELD_INPUT} mono text-left`}
                />
              </span>
              <Button
                variant="secondary"
                size="sm"
                disabled={!portDirty || saving}
                onClick={() => onSave({ proxy_host: store.proxy_host, proxy_port: parsed })}
              >
                <Icon name="check" size={13} />
                Apply
              </Button>
            </span>
          }
        />
      </GroupedList>
      {port !== "" && !portValid ? (
        <p className="px-[2px] text-note text-bad">A port between 1 and 65535.</p>
      ) : null}
    </Section>
  );
}
