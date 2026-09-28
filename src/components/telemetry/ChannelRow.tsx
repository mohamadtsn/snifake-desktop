import { Card } from "@/components/ui/Card";
import { Segmented } from "@/components/ui/Segmented";
import { StatusDot } from "@/components/ui/StatusDot";
import { MODES, MODE_ORDER } from "@/lib/modes";
import type { Store, TunnelMode, TunnelStore } from "@/types";
import { ProfilePicker } from "./ProfilePicker";

export function ChannelRow({
  store,
  tunnels,
  runningId,
  linkRunning,
  tunnelRunning,
  onSelectProfile,
  onSelectTunnel,
  onModeChange,
  systemProxyBlocked,
}: {
  store: Store | null;
  tunnels: TunnelStore | null;
  runningId: string | null;
  linkRunning: boolean;
  tunnelRunning: boolean;
  onSelectProfile: (id: string) => void;
  onSelectTunnel: (id: string) => void;
  onModeChange: (mode: TunnelMode) => void;
  /** `sysproxy_support()`: `null` when this desktop can be written to. */
  systemProxyBlocked?: string | null;
}) {
  const mode = tunnels?.mode ?? "manual";
  const info = MODES[mode];
  /** One resolution, shared with `ModeCards`. A machine that cannot have
   *  its proxy written must not be offered the mode on either screen. */
  const modeBlocked = (m: TunnelMode): string | null =>
    m === "system_proxy" ? (systemProxyBlocked ?? null) : MODES[m].blocked;
  const blocked = modeBlocked(mode);
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
              {/* The word here is what the mode *guarantees*, which for both
                  modes that exist is nothing. Saying "no guarantee" out loud
                  is the point; an unavailable mode says so instead. */}
              <span
                className={`mono text-micro tracking-[0.04em] uppercase ${
                  info.tone === "ok" ? "text-ok" : info.tone === "warn" ? "text-warn" : "text-t3"
                }`}
              >
                {blocked
                  ? mode === "tun"
                    ? "not yet available"
                    : "unsupported here"
                  : info.tone === "warn"
                    ? "best effort"
                    : "port only"}
              </span>
            </span>
          </div>

          <Segmented
            label="Routing mode"
            value={mode}
            onChange={onModeChange}
            options={MODE_ORDER.map((m) => ({
              value: m,
              label: MODES[m].name,
              // Resolved the same way `ModeCards` resolves it, or the two
              // screens disagree about what this machine can do - and this
              // one would offer a mode Sockets refuses.
              disabled: modeBlocked(m) !== null,
            }))}
            // `md`: this is the card's decision, and at `sm` it read as a
            // filter beside the profile selectors.
            size="md"
            stretch
          />

          <div className="flex items-end justify-between gap-3">
            <p className="min-w-0 flex-1 text-note leading-[16.5px] text-t2">
              {blocked ?? info.guarantee}
            </p>
            <span className="mono shrink-0 text-note text-t3" dir="ltr">
              {tunnels ? `${tunnels.proxy_host}:${tunnels.proxy_port}` : ""}
            </span>
          </div>
        </div>
      </Card>
    </div>
  );
}
