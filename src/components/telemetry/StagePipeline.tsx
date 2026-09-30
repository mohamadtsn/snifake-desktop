import type { ReactNode } from "react";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { CountryFlag } from "@/components/ui/CountryFlag";
import { Icon } from "@/components/ui/Icon";
import { StatusDot } from "@/components/ui/StatusDot";
import type { ExitProbe } from "@/lib/exitProbe";
import { exitReadout } from "@/lib/readouts";
import { formatRate, formatTotal, type Rate } from "@/lib/traffic";
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
 * what the application actually knows: where the stage is listening, how
 * long it has been up, and - new in this pass, and the first number here
 * that is *measured* - what is going through it.
 *
 * `frozen` is the uptime of a stage that faulted. The clock stops rather
 * than resetting, because "it ran for two minutes and then died" is the
 * useful fact and `00:00:00` is not.
 */
function StageTile({
  index,
  tone,
  condition,
  name,
  detail,
  since,
  frozen,
  meter,
  meterLabel,
  meterTitle,
  badge,
  sub,
  subTitle,
  onSub,
}: {
  index: 1 | 2;
  tone: Tone;
  condition: string;
  name: string;
  detail: string;
  since: number | null;
  /** The uptime at the moment the stage faulted; the clock is stopped. */
  frozen?: number | null;
  /** The measured line. `—` when there is no reading; never `0`. */
  meter?: string;
  meterLabel?: string;
  meterTitle?: string;
  badge?: string;
  /** A second fact under the name: the tunnel's exit. */
  sub?: ReactNode;
  subTitle?: string;
  /** Makes `sub` a button: check again. */
  onSub?: () => void;
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
        {sub ? (
          onSub ? (
            <button
              type="button"
              onClick={onSub}
              title={subTitle}
              className="mono mt-[1px] flex max-w-full items-center gap-[6px] truncate text-left text-note text-t2 hover:text-t1"
            >
              {sub}
            </button>
          ) : (
            <div
              className="mono mt-[1px] flex max-w-full items-center gap-[6px] truncate text-note text-t2"
              title={subTitle}
            >
              {sub}
            </div>
          )
        ) : null}
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
        ) : frozen != null ? (
          <p className="mt-[2px] flex items-baseline justify-end gap-[6px]">
            <span className="text-micro tracking-[0.04em] text-t3 uppercase">stopped at</span>
            <span className="mono text-note font-medium text-bad">{formatUptime(frozen)}</span>
          </p>
        ) : null}
        {meter ? (
          <p
            className="mt-[2px] flex items-baseline justify-end gap-[6px]"
            title={meterTitle}
          >
            <span className="text-micro tracking-[0.04em] text-t3 uppercase">{meterLabel}</span>
            <span className="mono text-note font-medium text-t1 tabular-nums">{meter}</span>
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
  rate,
  total,
  frozenSince,
  exit,
  onRecheckExit,
}: {
  state: ProxyState;
  since: number | null;
  listen: string;
  hasTunnel: boolean;
  coreInstalled: boolean;
  tunnelState: TunnelState;
  tunnelSince: number | null;
  signature: string;
  /** Live bytes per second, from `forward.rs`. `null` where unmeasurable. */
  rate: Rate;
  /** Cumulative bytes for this run, from the same counters. */
  total: { up: number; down: number } | null;
  /** How long the link had been up when it faulted, in ms. */
  frozenSince: number | null;
  /** Where the tunnel comes out, as ipinfo.io saw it through the tunnel. */
  exit: ExitProbe;
  onRecheckExit: () => void;
}) {
  const exitLine = exitReadout(exit);
  const exitText = exitLine ? [exitLine.primary, exitLine.secondary].filter(Boolean).join(" · ") : null;
  const exitSub = exitText ? (
    <>
      {exit.status === "ok" && exit.info.country ? (
        <CountryFlag code={exit.info.country} size="sm" />
      ) : null}
      <span className="truncate">{exitText}</span>
    </>
  ) : null;
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
  const stages = hasTunnel ? 2 : 1;

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
              stages {up}/{stages}
              {up === stages && up > 0 ? " synchronized" : ""}
            </span>
            <StatusDot tone={up === stages ? "ok" : up === 0 ? "off" : "warn"} size={6} />
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
            frozen={state === "error" && frozenSince !== null ? frozenSince : null}
            meterLabel="rate"
            meter={state === "running" ? `↑ ${formatRate(rate.up)}  ↓ ${formatRate(rate.down)}` : undefined}
            meterTitle="Bytes per second through the SNI forwarder, measured in forward.rs."
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
            meterLabel="session"
            meter={
              tunnelState === "active"
                ? `↓ ${formatTotal(total?.down ?? null)}  ↑ ${formatTotal(total?.up ?? null)}`
                : undefined
            }
            // One counter pair covers both stages: the tunnel's outbound
            // dials the SNI listener, so everything it carries passes
            // through that forwarder. A second counter inside the core
            // would be a second source that can disagree with this one.
            meterTitle="Total bytes relayed since the SNI link started. The tunnel dials that listener, so its traffic is counted here."
            badge={!hasTunnel ? "no tunnel" : !coreInstalled ? "core required" : undefined}
            sub={exitSub}
            subTitle={
              exit.status === "failed"
                ? exit.reason
                : "Seen by ipinfo.io through the tunnel. Click to check again."
            }
            onSub={exit.status === "ok" || exit.status === "failed" ? onRecheckExit : undefined}
          />
        </div>
      </div>
    </Card>
  );
}
