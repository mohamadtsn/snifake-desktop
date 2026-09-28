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
export function UpdateMeter({
  progress,
  pulse = false,
}: {
  progress: Progress | null;
  /** A leading dot that pings while bytes arrive and holds still once they
   *  have all arrived. The updater opts in; the core download does not. */
  pulse?: boolean;
}) {
  const total = progress?.total ?? null;
  const received = progress?.received ?? 0;
  const fraction = total ? Math.min(received / total, 1) : 0;
  const streaming = !progress || total === null || received < total;

  return (
    <div className="w-full">
      <div className="flex items-center gap-[10px]">
        {pulse ? (
          <span aria-hidden className="relative flex size-[8px] shrink-0">
            {streaming ? (
              <span className="meter-ping pointer-events-none absolute inset-0" />
            ) : null}
            <span className="relative size-[8px] rounded-full bg-accent" />
          </span>
        ) : null}
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
      </div>
      {/* `pl-[18px]` is the dot (8px) plus the gap (10px), so the readout
          lines up with the bar rather than with the dot. */}
      <p
        className={`mono pick mt-[6px] text-note leading-none text-t2 ${pulse ? "pl-[18px]" : ""}`}
        dir="ltr"
      >
        {total === null
          ? `${mib(received)} MB, size unknown`
          : `${mib(received)} / ${mib(total)} MB · ${Math.round(fraction * 100)}%`}
      </p>
    </div>
  );
}

const mib = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);
