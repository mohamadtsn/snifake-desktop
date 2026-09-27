import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { StatusDot } from "@/components/ui/StatusDot";
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
 */
const MODES: {
  value: TunnelMode;
  icon: string;
  name: string;
  does: string;
  guarantee: string;
}[] = [
  {
    value: "manual",
    icon: "tune",
    name: "Manual",
    does: "Only apps pointed directly at the local port.",
    guarantee: "None (only intercepts what you target).",
  },
  {
    value: "system_proxy",
    icon: "code",
    name: "System proxy",
    does: "Apps that read the system proxy setting.",
    guarantee: "None (apps bypassing the system proxy leak direct).",
  },
  {
    value: "tun",
    icon: "hub",
    name: "TUN (virtual)",
    does: "Entire operating-system network traffic.",
    guarantee: "Full system encapsulation. The only mode that can fail closed.",
  },
];

export function ModeCards({
  mode,
  bound,
  onChange,
}: {
  mode: TunnelMode;
  /** `proxy_host:proxy_port`, the address the first two modes are about. */
  bound: string;
  onChange: (mode: TunnelMode) => void;
}) {
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between gap-3 px-[2px]">
        <h2 className="text-note font-semibold tracking-[0.55px] text-t2 uppercase">
          Interception tier
        </h2>
        <span className="text-note text-t3">
          Active target <span className="text-accent">{MODES.find((m) => m.value === mode)?.name}</span>
        </span>
      </div>

      <div
        role="radiogroup"
        aria-label="Interception mode"
        className="grid grid-cols-3 items-stretch gap-[6px]"
      >
        {MODES.map((m) => {
          const selected = m.value === mode;
          return (
            <Card key={m.value} tone={selected ? "active" : "default"} className="overflow-hidden">
              <button
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onChange(m.value)}
                className="flex h-full w-full flex-col text-left"
              >
                <span className="flex flex-1 flex-col gap-1 p-3">
                  <span className="flex items-center justify-between gap-2">
                    <Icon name={m.icon} size={16} className={selected ? "text-ok" : "text-t3"} />
                    {selected ? (
                      <span className="flex items-center gap-[5px]">
                        <StatusDot tone="ok" size={6} glow />
                        <span className="mono text-micro tracking-[0.04em] text-ok uppercase">
                          active
                        </span>
                      </span>
                    ) : (
                      <Badge>{m.value === "manual" ? bound : "system"}</Badge>
                    )}
                  </span>
                  <span className={`text-row font-semibold ${selected ? "text-t1" : "text-t2"}`}>
                    {m.name}
                  </span>
                  <span className="text-note leading-[16.5px] text-t3">{m.does}</span>
                </span>
                <span className="block border-t border-hairline bg-inset px-3 py-[9px]">
                  <span className="flex items-center gap-[5px]">
                    <Icon
                      name={selected ? "verified_user" : "shield"}
                      size={12}
                      className={selected ? "text-ok" : "text-t4"}
                    />
                    <span
                      className={`mono text-micro tracking-[0.04em] uppercase ${
                        selected ? "text-ok" : "text-t4"
                      }`}
                    >
                      guarantee
                    </span>
                  </span>
                  <span
                    className={`mt-[3px] block text-note leading-[15px] ${
                      selected ? "text-t1" : "text-t3"
                    }`}
                  >
                    {m.guarantee}
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
