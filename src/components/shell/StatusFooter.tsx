import { FooterEndpoints } from "@/components/shell/FooterEndpoints";
import { FooterTraffic } from "@/components/shell/FooterTraffic";
import type { Rate } from "@/lib/traffic";

/**
 * 36px of fixed chrome. Three readouts, all real.
 *
 * The left pair says where each stage is listening - the two addresses a
 * user actually needs to type somewhere - with the icon tinted by whether
 * that stage is up. The right pair is live throughput, which is measurable
 * for the first time: `forward.rs` counts the bytes it relays, and because
 * the tunnel's outbound dials that same listener, one pair of counters
 * covers both stages.
 *
 * What was here before: `activeRoute()` on the left, restating the active
 * profile the header already names, and `Tray menu active` on the right.
 * The tray hint described a *preference*, and a status bar that spends a
 * third of its width restating a setting is reporting on itself instead of
 * on the program. That sentence now lives in Preferences → General, beside
 * the switch it describes.
 */
export function StatusFooter({
  link,
  linkLive,
  tunnel,
  tunnelLive,
  tunnelRemote,
  rate,
}: {
  link: string | null;
  linkLive: boolean;
  tunnel: string | null;
  tunnelLive: boolean;
  tunnelRemote: string | null;
  rate: Rate;
}) {
  return (
    <footer
      data-tauri-drag-region
      className="flex h-[var(--h-footer)] shrink-0 items-center justify-between gap-4 border-t border-hairline bg-surface px-4"
    >
      <FooterEndpoints
        link={link}
        linkLive={linkLive}
        tunnel={tunnel}
        tunnelLive={tunnelLive}
        tunnelRemote={tunnelRemote}
      />
      <FooterTraffic rate={rate} />
    </footer>
  );
}
