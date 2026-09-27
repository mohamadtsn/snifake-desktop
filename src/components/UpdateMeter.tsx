import { type Progress } from "@/lib/updater";

/**
 * Real bytes, never a fake sweep to fill the wait - except when the server
 * sends no content-length, and then the bar says exactly that by refusing to
 * claim a position it does not have.
 *
 * The one progress bar in the application (`DESIGN.md` 4.6). It is shared by
 * the updater and by the core download, because a second bar would be a
 * second visual language for the same idea.
 */
export function UpdateMeter({ progress }: { progress: Progress | null }) {
  const total = progress?.total ?? null;
  const received = progress?.received ?? 0;
  const fraction = total ? Math.min(received / total, 1) : 0;

  return (
    <div className="w-full">
      <div
        className="relative h-[6px] w-full overflow-hidden rounded-full bg-inset shadow-sunken"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total ?? undefined}
        aria-valuenow={total ? received : undefined}
      >
        {total === null ? (
          /* Indeterminate: a band that travels, so the wait is visibly
             alive without the bar claiming a position. */
          <div className="meter-sweep absolute inset-y-0 w-1/3 rounded-full bg-accent" />
        ) : (
          <div
            className="h-full origin-left rounded-full bg-accent transition-transform duration-(--dur-fast) ease-(--ease-out)"
            style={{ transform: `scaleX(${fraction})` }}
          />
        )}
      </div>
      <p className="mono pick mt-[6px] text-note leading-none text-t2" dir="ltr">
        {total === null
          ? `${mib(received)} MB, size unknown`
          : `${mib(received)} / ${mib(total)} MB · ${Math.round(fraction * 100)}%`}
      </p>
    </div>
  );
}

const mib = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);
