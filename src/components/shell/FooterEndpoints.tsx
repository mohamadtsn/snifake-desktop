import { CountryFlag } from "@/components/ui/CountryFlag";
import { Icon } from "@/components/ui/Icon";
import { countryName } from "@/lib/countries";
import { endpointLabel } from "@/lib/readouts";

/**
 * Where each stage is listening, at a glance.
 *
 * The tunnel shows its *local* inbound rather than the remote host,
 * because that is the address a user points an application at. The remote
 * host is in the title, where it answers "which server" without taking
 * width from the thing that gets typed into a proxy field.
 *
 * The icon carries the live/idle distinction rather than the text: a row
 * that greys out entirely reads as disabled, and these are readouts, not
 * controls. Idle is `t3`, not `t4` - at 0.22 alpha the glyph reads as
 * absent rather than as off, and both states have to be legible for the
 * tint to mean anything.
 */
export function FooterEndpoints({
  link,
  linkLive,
  tunnel,
  tunnelLive,
  tunnelRemote,
  exitCountry,
}: {
  link: string | null;
  linkLive: boolean;
  tunnel: string | null;
  tunnelLive: boolean;
  tunnelRemote: string | null;
  exitCountry?: string | null;
}) {
  const isExitReading = tunnel?.startsWith("exit ");
  const countryFull = exitCountry ? countryName(exitCountry) : null;
  const egressTitle = tunnelRemote
    ? `Tunnel egress · ${tunnelRemote}${countryFull ? ` (${countryFull})` : ""}`
    : countryFull
      ? `Tunnel egress · ${countryFull}`
      : "Tunnel egress";

  return (
    <div className="flex min-w-0 items-center gap-4">
      <span className="flex min-w-0 items-center gap-[6px]" title="SNI link inbound">
        <Icon name="link" size={13} className={linkLive ? "text-ok" : "text-t3"} />
        <span className="mono truncate text-note text-t2">{endpointLabel(link)}</span>
      </span>
      <span className="h-[12px] w-px shrink-0 bg-hairline" aria-hidden />
      <span className="flex min-w-0 items-center gap-[6px]" title={egressTitle}>
        <Icon name="vpn_lock" size={13} className={tunnelLive ? "text-ok" : "text-t3"} />
        {isExitReading && exitCountry ? (
          <CountryFlag code={exitCountry} size="xs" />
        ) : null}
        <span className="mono truncate text-note text-t2">{endpointLabel(tunnel)}</span>
      </span>
    </div>
  );
}
