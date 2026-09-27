import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";

/**
 * One sentence saying what the combination of stages currently means.
 *
 * The mockup put `0 DROP` here, and a `1,420 pkts/s` counter beside it.
 * Neither exists: the engine reports no counters at all. What it does
 * report is which stages are up, and the useful thing to say about that is
 * the consequence - whether traffic is going through the tunnel or past it.
 */
export function StatusStrip({
  tone,
  message,
  badge,
}: {
  tone: "ok" | "warn" | "bad" | "off";
  message: string;
  badge?: string;
}) {
  const icon = tone === "ok" ? "check_circle" : tone === "bad" ? "error" : "info";
  const color =
    tone === "ok" ? "text-ok" : tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : "text-t3";
  return (
    <div className="flex items-center gap-3 rounded-md border border-hairline bg-inset px-3 py-[9px]">
      <Icon name={icon} size={16} className={`shrink-0 ${color}`} />
      <p className="min-w-0 flex-1 text-body text-t2">{message}</p>
      {badge ? <Badge tone={tone === "off" ? "neutral" : tone}>{badge}</Badge> : null}
    </div>
  );
}
