import { PowerSwitch } from "@/components/PowerSwitch";
import { tunnelSignalState, type ProxyState, type TunnelState } from "@/types";

/**
 * One switch becomes two the moment a tunnel exists.
 *
 * A row of switches is the native idiom for the console language — real
 * equipment has banks of them — and it keeps both controls where the eye
 * already is. `PowerSwitch` is reused unchanged in the single case, so a
 * user with no tunnel sees exactly the control they had before.
 *
 * The tunnel switch carries its own reason for being disabled. Teaching
 * the dependency before the click is the whole point; an error afterwards
 * would be telling someone off for not knowing something we never showed
 * them.
 */
export function SwitchBank({
  link,
  tunnel,
  showTunnel,
  disabledReason,
  onLinkStart,
  onLinkStop,
  onTunnelStart,
  onTunnelStop,
}: {
  link: ProxyState;
  tunnel: TunnelState;
  showTunnel: boolean;
  /** `null` when a tunnel start is allowed. */
  disabledReason: string | null;
  onLinkStart: () => void;
  onLinkStop: () => void;
  onTunnelStart: () => void;
  onTunnelStop: () => void;
}) {
  if (!showTunnel) {
    return <PowerSwitch state={link} onStart={onLinkStart} onStop={onLinkStop} />;
  }

  // A running tunnel is never blocked: whatever the reason says, Stop has
  // to stay reachable, the same call PowerSwitch already makes for Start.
  const running = tunnel !== "offline";
  const blocked = disabledReason !== null && !running;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="grid grid-cols-2 gap-2">
        <PowerSwitch state={link} label="Link" onStart={onLinkStart} onStop={onLinkStop} />
        <PowerSwitch
          state={tunnelSignalState(tunnel)}
          label="Tunnel"
          disabled={blocked}
          describedBy={blocked ? "tunnel-blocked" : undefined}
          onStart={onTunnelStart}
          onStop={onTunnelStop}
        />
      </div>
      {/* Height reserved either way, so appearing and disappearing never
          moves the switches under the pointer. */}
      <p
        id="tunnel-blocked"
        className="text-faint min-h-[13px] text-center text-[10px] leading-none"
      >
        {blocked ? disabledReason : ""}
      </p>
    </div>
  );
}
