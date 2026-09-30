import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { StatusDot } from "@/components/ui/StatusDot";
import { MODES, MODE_ORDER, modeBlockedReason, tunGuarantee } from "@/lib/modes";
import type { TunnelMode } from "@/types";

/**
 * The three interception modes, each stating what it does *and does not*
 * capture, on the face.
 *
 * This is the single largest usability gain in the redesign. A user picking
 * "System proxy" is choosing a mode that guarantees nothing, and there is no
 * way to know that from the words "system proxy". Saying it in the card,
 * before the choice, is the difference between a setting and a trap.
 *
 * The guarantee lines are the mockup's own, kept verbatim.
 *
 * `systemProxyBlocked` is `sysproxy::support()`'s reason, in words. A
 * desktop with neither `gsettings` nor `kwriteconfig` cannot have its proxy
 * written, and a mode that silently does nothing is the exact failure this
 * round of feedback reported - so it is refused on the card's face, in the
 * and TUN is refused the same way, with `tun_support()`'s sentence.
 */
export function ModeCards({
  mode,
  bound,
  onChange,
  systemProxyBlocked,
  tunBlocked,
  killSwitch,
}: {
  mode: TunnelMode;
  /** `proxy_host:proxy_port`, the address the first two modes are about. */
  bound: string;
  onChange: (mode: TunnelMode) => void;
  /** `sysproxy_support()`: `null` when this desktop can be written to. */
  systemProxyBlocked?: string | null;
  /** `tun_support()`: `null` when TUN can run on this machine. */
  tunBlocked?: string | null;
  /** `Routing.kill_switch`: TUN's guarantee depends on it. */
  killSwitch: boolean;
}) {
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between gap-3 px-[2px]">
        <h2 className="text-note font-semibold tracking-[0.55px] text-t2 uppercase">
          Interception tier
        </h2>
        <span className="text-note text-t3">
          Active target <span className="text-accent">{MODES[mode].name}</span>
        </span>
      </div>

      <div
        role="radiogroup"
        aria-label="Interception mode"
        className="grid grid-cols-3 items-stretch gap-[6px]"
      >
        {MODE_ORDER.map((key) => {
          const m = MODES[key];
          const selected = m.value === mode;
          const blocked = modeBlockedReason(m.value, {
            systemProxy: systemProxyBlocked ?? null,
            tun: tunBlocked ?? null,
          });
          return (
            <Card
              key={m.value}
              tone={selected && !blocked ? "active" : "default"}
              className={`overflow-hidden ${blocked ? "opacity-55" : ""}`}
            >
              <button
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={Boolean(blocked)}
                title={blocked ?? undefined}
                onClick={() => onChange(m.value)}
                className="flex h-full w-full flex-col text-left disabled:cursor-default"
              >
                <span className="flex flex-1 flex-col gap-1 p-3">
                  <span className="flex items-center justify-between gap-2">
                    <Icon name={m.icon} size={16} className={selected ? "text-ok" : "text-t3"} />
                    {blocked ? (
                      <Badge tone="warn">unsupported</Badge>
                    ) : selected ? (
                      <span className="flex items-center gap-[5px]">
                        <StatusDot tone="ok" size={6} glow />
                        <span className="mono text-micro tracking-[0.04em] text-ok uppercase">
                          active
                        </span>
                      </span>
                    ) : m.value === "manual" ? (
                      <Badge>{bound}</Badge>
                    ) : null}
                  </span>
                  <span
                    className={`text-row font-semibold ${
                      blocked ? "text-t3" : selected ? "text-t1" : "text-t2"
                    }`}
                  >
                    {m.name}
                  </span>
                  <span className="text-note leading-[16.5px] text-t3">
                    {blocked ?? m.does}
                  </span>
                </span>
                <span className="block border-t border-hairline bg-inset px-3 py-[9px]">
                  <span className="flex items-center gap-[5px]">
                    <Icon
                      name={selected && !blocked ? "verified_user" : "shield"}
                      size={12}
                      className={selected && !blocked ? "text-ok" : "text-t4"}
                    />
                    <span
                      className={`mono text-micro tracking-[0.04em] uppercase ${
                        selected && !blocked ? "text-ok" : "text-t4"
                      }`}
                    >
                      guarantee
                    </span>
                  </span>
                  <span
                    className={`mt-[3px] block text-note leading-[15px] ${
                      selected && !blocked ? "text-t1" : "text-t3"
                    }`}
                  >
                    {key === "tun" ? tunGuarantee(killSwitch) : m.guarantee}
                  </span>
                </span>
              </button>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
