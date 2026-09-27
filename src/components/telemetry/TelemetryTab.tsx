import { useEffect, useState } from "react";
import { ActivitySection } from "@/components/ActivitySection";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { listenAddress, tunnelSignature, tunnelSni } from "@/lib/readouts";
import type { Rate } from "@/lib/traffic";
import { activeTunnel, type ProxyState, type Store, type TunnelMode, type TunnelState, type TunnelStore } from "@/types";
import { activeProfile } from "@/types";
import { ActuatorCard } from "./ActuatorCard";
import { ChannelRow } from "./ChannelRow";
import { StagePipeline } from "./StagePipeline";
import { StatusStrip } from "./StatusStrip";

/** The sentence under the two switches. It states the consequence of the
 *  current combination, which is the thing a counter was standing in for. */
function strip(
  state: ProxyState,
  tunnelState: TunnelState,
  hasTunnel: boolean,
  coreInstalled: boolean,
): { tone: "ok" | "warn" | "bad" | "off"; message: string; badge?: string } {
  if (state === "error")
    return { tone: "bad", message: "The SNI link faulted. Nothing is being relayed.", badge: "fault" };
  if (tunnelState === "fault")
    return { tone: "bad", message: "The tunnel faulted. The SNI link is still running.", badge: "fault" };
  // Holding is checked before "nothing is running", because holding is
  // precisely the case where the link is down and the tunnel is not: it is
  // fail-closed, and saying nothing is running would hide the one thing
  // still holding traffic back.
  if (tunnelState === "holding")
    return {
      tone: "warn",
      message: "The tunnel is holding traffic: it will not relay while the SNI link it dials is down.",
      badge: "hold",
    };
  if (state !== "running")
    return { tone: "off", message: "Nothing is running. Start the SNI link to begin." };
  if (tunnelState === "active")
    return { tone: "ok", message: "Both stages are up. Traffic goes through the tunnel.", badge: "tunnelled" };
  if (tunnelState === "starting")
    return { tone: "warn", message: "The tunnel is starting. It dials the SNI link's listener." };
  if (!hasTunnel)
    return {
      tone: "warn",
      message: "The SNI link is running on its own. No tunnel is configured, so traffic is not encrypted by this application.",
      badge: "bypass",
    };
  if (!coreInstalled)
    return {
      tone: "warn",
      message: "The SNI link is running on its own. The tunnel needs its core before it can start.",
      badge: "bypass",
    };
  return {
    tone: "warn",
    message: "The SNI link is running on its own. The tunnel is configured but switched off.",
    badge: "bypass",
  };
}

export function TelemetryTab({
  store,
  tunnels,
  state,
  since,
  runningId,
  tunnelState,
  tunnelSince,
  rate,
  total,
  frozenSince,
  systemProxyBlocked,
  coreInstalled,
  blockedReason,
  activityOpen,
  onActivityOpenChange,
  verbose,
  onVerboseChange,
  onLinkToggle,
  onTunnelToggle,
  onSelectProfile,
  onSelectTunnel,
  onModeChange,
  onSetupCore,
}: {
  store: Store | null;
  tunnels: TunnelStore | null;
  state: ProxyState;
  since: number | null;
  runningId: string | null;
  tunnelState: TunnelState;
  tunnelSince: number | null;
  rate: Rate;
  total: { up: number; down: number } | null;
  frozenSince: number | null;
  /** `sysproxy_support()`: `null` when this desktop can be written to. */
  systemProxyBlocked: string | null;
  coreInstalled: boolean;
  /** `canStartTunnel`'s sentence, or null when the tunnel may start. */
  blockedReason: string | null;
  activityOpen: boolean;
  onActivityOpenChange: (open: boolean) => void;
  verbose: boolean;
  onVerboseChange: (on: boolean) => void;
  onLinkToggle: (on: boolean) => void;
  onTunnelToggle: (on: boolean) => void;
  onSelectProfile: (id: string) => void;
  onSelectTunnel: (id: string) => void;
  onModeChange: (mode: TunnelMode) => void;
  onSetupCore: () => void;
}) {
  // The clock. `formatUptime(Date.now() - since)` is computed at render, so
  // without something to render on it reads 0s and then jumps whenever some
  // unrelated state changes. One interval, and only while something is
  // actually up: a timer running against a stopped engine is a render a
  // second for a number that cannot change.
  const ticking = state === "running" || tunnelState === "active";
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!ticking) return;
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [ticking]);

  const profile = store ? activeProfile(store) : undefined;
  const tunnel = tunnels ? activeTunnel(tunnels) : undefined;
  const hasTunnel = (tunnels?.tunnels.length ?? 0) > 0;
  const tunnelRunning = tunnelState !== "offline";
  const note = strip(state, tunnelState, hasTunnel, coreInstalled);

  return (
    <div className="flex flex-col gap-4 px-5 py-5">
      <StagePipeline
        state={state}
        since={since}
        listen={listenAddress(profile)}
        hasTunnel={hasTunnel}
        coreInstalled={coreInstalled}
        tunnelState={tunnelState}
        tunnelSince={tunnelSince}
        signature={tunnelSignature(tunnel)}
        rate={rate}
        total={total}
        frozenSince={frozenSince}
      />

      <Card>
        <div className="flex flex-col gap-4 p-4">
          <div className="flex items-stretch gap-4">
            <ActuatorCard
              icon="bolt"
              title="Link actuator"
              subject="SNI fake link"
              detail={listenAddress(profile)}
              engaged={state === "running" || state === "starting"}
              onChange={onLinkToggle}
              blocked={profile ? null : "No SNI profile configured."}
              status={
                state === "running"
                  ? { label: "engaged", tone: "ok" }
                  : state === "starting"
                    ? { label: "starting", tone: "warn" }
                    : state === "error"
                      ? { label: "fault", tone: "bad" }
                      : profile
                        ? { label: "idle", tone: "neutral" }
                        : { label: "no profile", tone: "warn" }
              }
            />
            <span className="w-px shrink-0 self-stretch bg-hairline" aria-hidden />
            <ActuatorCard
              icon="shield"
              title="Tunnel relay"
              subject="Encrypted tunnel"
              detail={tunnel ? `SNI ${tunnelSni(tunnel)}` : "no tunnel"}
              engaged={tunnelRunning}
              onChange={onTunnelToggle}
              blocked={blockedReason}
              status={
                tunnelState === "active"
                  ? { label: "engaged", tone: "ok" }
                  : tunnelState === "holding"
                    ? { label: "hold", tone: "warn" }
                    : tunnelState === "starting"
                      ? { label: "starting", tone: "warn" }
                      : tunnelState === "fault"
                        ? { label: "fault", tone: "bad" }
                        : !hasTunnel
                          ? { label: "no tunnel", tone: "warn" }
                          : !coreInstalled
                            ? { label: "core required", tone: "warn" }
                            : { label: "idle", tone: "neutral" }
              }
              action={
                !coreInstalled && hasTunnel ? (
                  <Button size="sm" variant="secondary" onClick={onSetupCore}>
                    Set up core
                  </Button>
                ) : undefined
              }
            />
          </div>
          <StatusStrip tone={note.tone} message={note.message} badge={note.badge} />
        </div>
      </Card>

      <ChannelRow
        store={store}
        tunnels={tunnels}
        runningId={runningId}
        linkRunning={state === "running"}
        tunnelRunning={tunnelRunning}
        systemProxyBlocked={systemProxyBlocked}
        onSelectProfile={onSelectProfile}
        onSelectTunnel={onSelectTunnel}
        onModeChange={onModeChange}
      />

      <ActivitySection
        open={activityOpen}
        onOpenChange={onActivityOpenChange}
        verbose={verbose}
        onVerboseChange={onVerboseChange}
      />
    </div>
  );
}
