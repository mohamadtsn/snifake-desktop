import { Icon } from "@/components/ui/Icon";
import { formatRate, type Rate } from "@/lib/traffic";

/**
 * The only throughput number in the application, and the first one that is
 * measured rather than drawn.
 *
 * `tabular-nums` because the value changes once a second: without it the
 * row reflows on every tick and the eye cannot hold the number still.
 *
 * A tinted arrow means bytes are moving *now*. A measured zero is not
 * movement, so `0` tints idle while the text still says `0 B/s` - the
 * colour reports the flow, the number reports the reading.
 */
export function FooterTraffic({ rate }: { rate: Rate }) {
  return (
    <div className="flex shrink-0 items-center gap-3" aria-label="Throughput">
      <span className="flex items-center gap-[4px]">
        <Icon name="arrow_upward" size={12} className={rate.up ? "text-accent" : "text-t3"} />
        <span className="mono text-note tabular-nums text-t2">{formatRate(rate.up)}</span>
      </span>
      <span className="flex items-center gap-[4px]">
        <Icon name="arrow_downward" size={12} className={rate.down ? "text-ok" : "text-t3"} />
        <span className="mono text-note tabular-nums text-t2">{formatRate(rate.down)}</span>
      </span>
    </div>
  );
}
