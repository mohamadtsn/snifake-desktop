import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { StatusDot } from "@/components/ui/StatusDot";
import { formatUptime } from "@/types";
import type { ProxyState, TunnelState } from "@/types";

type Tone = "off" | "ok" | "warn" | "bad";

const TEXT_TONE: Record<Tone, string> = {
  off: "text-t3",
  ok: "text-ok",
  warn: "text-warn",
  bad: "text-bad",
};

/**
 * One stage, as it is right now: its condition, its name, and the one real
 * fact about it that is worth reading at a glance.
 *
 * The mockup's right-hand slots were a `-58 dBm` signal meter and an RTT
 * sparkline. There is no radio and there is no probe, so the slots carry
 * what the application actually knows: where the stage is listening, and how
 * long it has been up.
 */
function StageTile({
  index,
  tone,
  condition,
  name,
  detail,
  since,
  badge,
}: {
  index: 1 | 2;
  tone: Tone;
  condition: string;
  name: string;
  detail: string;
  since: number | null;
  badge?: string;
}) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3 rounded-md border border-hairline bg-inset px-[14px] py-[11px]">
      <StatusDot tone={tone} size={8} glow={tone === "ok"} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={`text-row font-semibold ${TEXT_TONE[tone]}`}>{condition}</span>
          <Badge tone={badge ? "warn" : "neutral"}>{badge ?? `Stage ${index}`}</Badge>
        </div>
        <p className="mt-[1px] truncate text-body text-t2">{name}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className="mono truncate text-note text-t3">{detail}</p>
        {since !== null ? (
          <p className="mt-[2px] flex items-baseline justify-end gap-[6px]">
            <span className="text-micro tracking-[0.04em] text-t3 uppercase">uptime</span>
            <span className="mono text-note font-medium text-t1">
              {formatUptime(Date.now() - since)}
            </span>
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The two stages side by side, because they are one pipeline: the tunnel
 * dials the link's listener, so it cannot run without it. Two separate cards
 * would say they were independent, and the whole point of the second mockup
 * is that they are not.
 */
export function StagePipeline({
  state,
  since,
  listen,
  hasTunnel,
  coreInstalled,
  tunnelState,
  tunnelSince,
  signature,
}: {
  state: ProxyState;
  since: number | null;
  listen: string;
  hasTunnel: boolean;
  coreInstalled: boolean;
  tunnelState: TunnelState;
  tunnelSince: number | null;
  signature: string;
}) {
  const linkTone: Tone =
    state === "running" ? "ok" : state === "starting" ? "warn" : state === "error" ? "bad" : "off";

  // "Standby" and "offline" are different claims. The second stage is on
  // standby when something it needs is missing and offline when it is simply
  // not running, and the badge says which.
  const blocked = !hasTunnel || !coreInstalled;
  const tunnelTone: Tone = blocked
    ? "warn"
    : tunnelState === "active"
      ? "ok"
      : tunnelState === "starting" || tunnelState === "holding"
        ? "warn"
        : tunnelState === "fault"
          ? "bad"
          : "off";

  const up = (state === "running" ? 1 : 0) + (tunnelState === "active" ? 1 : 0);
  const total = hasTunnel ? 2 : 1;

  return (
    <Card>
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Icon name="account_tree" size={16} className="text-accent" />
            <h2 className="text-row font-semibold text-t1">Stage pipeline</h2>
          </div>
          <div className="flex items-center gap-2">
            <span className="mono text-note tracking-[0.04em] text-t3 uppercase">
              stages {up}/{total}
            </span>
            <StatusDot tone={up === total ? "ok" : up === 0 ? "off" : "warn"} size={6} />
          </div>
        </div>

        <div className="flex items-stretch gap-3">
          <StageTile
            index={1}
            tone={linkTone}
            condition={
              state === "running"
                ? "Active"
                : state === "starting"
                  ? "Starting"
                  : state === "error"
                    ? "Fault"
                    : "Offline"
            }
            name="SNI dispatcher link"
            detail={listen}
            since={state === "running" ? since : null}
          />
          <StageTile
            index={2}
            tone={tunnelTone}
            condition={
              blocked
                ? "Standby"
                : tunnelState === "active"
                  ? "Active"
                  : tunnelState === "holding"
                    ? "Hold"
                    : tunnelState === "starting"
                      ? "Starting"
                      : tunnelState === "fault"
                        ? "Fault"
                        : "Offline"
            }
            name="Upstream tunnel layer"
            detail={signature}
            since={tunnelState === "active" ? tunnelSince : null}
            badge={!hasTunnel ? "no tunnel" : !coreInstalled ? "core required" : undefined}
          />
        </div>
      </div>
    </Card>
  );
}
