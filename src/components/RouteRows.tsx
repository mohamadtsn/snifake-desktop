import { Profile } from "@/types";

/**
 * Where the traffic actually goes. Read-only, and nowhere near the switch's
 * hit area: checking your route must never risk toggling it.
 *
 * Host and port are separate columns rather than one `host:port` string, so
 * the ports line up vertically and a wrong port is visible without reading.
 * The whole block is a fixed three-column grid for exactly that reason.
 */
export function RouteRows({ profile }: { profile: Profile }) {
  return (
    <section className="flex shrink-0 flex-col gap-2.5">
      <h2 className="engrave">Route</h2>

      <dl className="grid grid-cols-[62px_1fr_auto] items-baseline gap-x-3 gap-y-1.5">
        <Row label="Listen" host={profile.LISTEN_HOST} port={profile.LISTEN_PORT} />
        <Row label="Upstream" host={profile.CONNECT_IP} port={profile.CONNECT_PORT} />
        <Row label="SNI" host={profile.FAKE_SNI} />
      </dl>
    </section>
  );
}

function Row({ label, host, port }: { label: string; host: string; port?: number }) {
  return (
    <>
      <dt
        className="text-faint text-[9.5px] uppercase"
        style={{ letterSpacing: "var(--track-engrave)" }}
      >
        {label}
      </dt>
      {/* Addresses and hostnames are never prose: always LTR, always
          left-read, whatever the surrounding UI language is. */}
      <dd dir="ltr" className="text-dim truncate text-left text-[12px] leading-none">
        {host || <span className="text-ghost">unset</span>}
      </dd>
      <dd className="text-[12px] leading-none">
        {port === undefined ? (
          <span className="text-ghost">—</span>
        ) : (
          <>
            <span className="text-faint">:</span>
            <span className="text-text">{port}</span>
          </>
        )}
      </dd>
    </>
  );
}
