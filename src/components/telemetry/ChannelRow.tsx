import { Card } from "@/components/ui/Card";
import { Segmented } from "@/components/ui/Segmented";
import { StatusDot } from "@/components/ui/StatusDot";
import type { Store, TunnelMode, TunnelStore } from "@/types";
import { ProfilePicker } from "./ProfilePicker";

/**
 * What each mode does, and what it does not.
 *
 * This is the single biggest honesty gain in the redesign, and it is three
 * sentences. `System proxy` guaranteeing nothing is not a caveat in small
 * print; it is the fact that decides whether the mode is the right one, and
 * it belongs where the mode is chosen.
 */
const MODES: Record<TunnelMode, { label: string; blurb: string; guarantee: string; tone: "ok" | "warn" | "neutral" }> = {
  manual: {
    label: "Manual",
    blurb: "Only applications you point at the port below. Nothing else is captured.",
    guarantee: "port only",
    tone: "neutral",
  },
  system_proxy: {
    label: "System proxy",
    blurb: "Sets the system proxy. Nothing compels an application to honour it.",
    guarantee: "best effort",
    tone: "warn",
  },
  tun: {
    label: "TUN",
    blurb: "Captures everything. The only mode that can fail closed.",
    guarantee: "fails closed",
    tone: "ok",
  },
};

export function ChannelRow({
  store,
  tunnels,
  runningId,
  linkRunning,
  tunnelRunning,
  onSelectProfile,
  onSelectTunnel,
  onModeChange,
}: {
  store: Store | null;
  tunnels: TunnelStore | null;
  runningId: string | null;
  linkRunning: boolean;
  tunnelRunning: boolean;
  onSelectProfile: (id: string) => void;
  onSelectTunnel: (id: string) => void;
  onModeChange: (mode: TunnelMode) => void;
}) {
  const mode = tunnels?.mode ?? "manual";
  const info = MODES[mode];
  const hasTunnels = (tunnels?.tunnels.length ?? 0) > 0;
  // The engine is the authority on whether the link is up; `runningId` only
  // narrows it to *which* profile, and is null when nothing started it from
  // this window.
  const live = linkRunning && (runningId === null || runningId === store?.active_id);

  return (
    <div className="flex items-stretch gap-4">
      <Card className="min-w-0 flex-1">
        <div className="flex flex-col gap-3 p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-row font-semibold text-t1">Active profiles</h2>
            <span className="mono text-micro tracking-[0.04em] text-t3 uppercase">
              {store?.profiles.length ?? 0} sni · {tunnels?.tunnels.length ?? 0} tunnel
            </span>
          </div>
          <div className="flex items-start gap-3">
            <ProfilePicker
              label="SNI profile"
              icon="lan"
              items={store?.profiles ?? []}
              activeId={store?.active_id ?? null}
              status={live ? "live" : store?.active_id ? "selected" : "none"}
              statusTone={live ? "text-ok" : "text-t3"}
              onSelect={onSelectProfile}
              empty="No SNI link configured"
            />
            <ProfilePicker
              label="Tunnel profile"
              icon="vpn_lock"
              items={tunnels?.tunnels ?? []}
              activeId={tunnels?.active_id ?? null}
              status={tunnelRunning ? "live" : hasTunnels ? "selected" : "none"}
              statusTone={tunnelRunning ? "text-ok" : hasTunnels ? "text-t3" : "text-warn"}
              onSelect={onSelectTunnel}
              empty="No tunnel configured"
            />
          </div>
        </div>
      </Card>

      <Card className="min-w-0 flex-1">
        <div className="flex flex-col gap-3 p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-row font-semibold text-t1">Routing mode</h2>
            <span className="flex items-center gap-[6px]">
              <StatusDot tone={info.tone === "neutral" ? "off" : info.tone} size={6} />
              <span
                className={`mono text-micro tracking-[0.04em] uppercase ${
                  info.tone === "ok" ? "text-ok" : info.tone === "warn" ? "text-warn" : "text-t3"
                }`}
              >
                {info.guarantee}
              </span>
            </span>
          </div>

          <Segmented
            label="Routing mode"
            value={mode}
            onChange={onModeChange}
            options={(Object.keys(MODES) as TunnelMode[]).map((m) => ({
              value: m,
              label: MODES[m].label,
            }))}
            size="sm"
            stretch
          />

          <div className="flex items-end justify-between gap-3">
            <p className="min-w-0 flex-1 text-note leading-[16.5px] text-t2">{info.blurb}</p>
            <span className="mono shrink-0 text-note text-t3" dir="ltr">
              {tunnels ? `${tunnels.proxy_host}:${tunnels.proxy_port}` : ""}
            </span>
          </div>
        </div>
      </Card>
    </div>
  );
}
