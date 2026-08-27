import { Profile } from "@/types";

/**
 * The route the proxy is using, or would use. Read-only, and deliberately
 * outside the disc's hit area: reading where your traffic goes must never
 * risk toggling it.
 */
export function RouteRows({ profile }: { profile: Profile }) {
  const rows: [string, string][] = [
    ["Listen", `${profile.LISTEN_HOST}:${profile.LISTEN_PORT}`],
    ["Upstream", `${profile.CONNECT_IP}:${profile.CONNECT_PORT}`],
    ["SNI", profile.FAKE_SNI],
  ];
  return (
    <div className="raised flex shrink-0 flex-col gap-2 px-4 py-3">
      {rows.map(([label, value]) => (
        <div key={label} className="grid grid-cols-[68px_1fr] items-baseline gap-2">
          <span
            className="text-faint text-[10px] uppercase"
            style={{ letterSpacing: "var(--track-micro)" }}
          >
            {label}
          </span>
          <span dir="ltr" className="text-dim tnum truncate text-left font-mono text-[11.5px]">
            {value}
          </span>
        </div>
      ))}
    </div>
  );
}
