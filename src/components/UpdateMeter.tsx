import { type Progress } from "@/lib/updater";

/**
 * Real bytes, never a fake sweep to fill the wait — except when the server
 * sends no content-length, and then the bar says exactly that by refusing to
 * claim a position.
 *
 * The one progress bar in the application (`DESIGN.md §4.6`). It lives here
 * rather than inside `App.tsx` because the core download needs it too, and a
 * second bar would be a second visual language for the same idea.
 */
export function UpdateMeter({ progress }: { progress: Progress | null }) {
  const total = progress?.total ?? null;
  const received = progress?.received ?? 0;
  const fraction = total ? Math.min(received / total, 1) : 0;

  return (
    <div className="mt-3">
      <div
        className="meter"
        data-indeterminate={total === null ? "" : undefined}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total ?? undefined}
        aria-valuenow={total ? received : undefined}
      >
        {/* No inline transform while indeterminate: it would win over the
            sweep's own scaleX and leave a bar of zero width. */}
        <div
          className="meter-fill"
          style={total ? { transform: `scaleX(${fraction})` } : undefined}
        />
      </div>
      <p className="value-face text-dim pick mt-1.5 text-[10.5px] leading-none" dir="ltr">
        {total === null
          ? `${mib(received)} MB`
          : `${mib(received)} / ${mib(total)} MB · ${Math.round(fraction * 100)}%`}
      </p>
    </div>
  );
}

const mib = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);
