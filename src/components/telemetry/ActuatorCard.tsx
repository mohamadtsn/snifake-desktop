import type { ReactNode } from "react";
import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import { PowerButton } from "./PowerButton";

/**
 * One stage's control, and the two facts you need before pressing it.
 *
 * `PowerButton` is the only control in the application that starts or stops a
 * stage, and it is drawn at the weight of that decision. It was a pill
 * switch in the card's corner, which is the same size this design system
 * gives a preference - the one action the screen exists for cannot be the
 * same weight as "colorize the tray icon". Like the switch it replaced, it
 * can say "you cannot do this yet" by being disabled, and its halo takes the
 * status badge's colour so the two cannot disagree.
 *
 * `blocked` is a sentence, not a boolean: `canStartTunnel` returns the
 * reason, and showing the reason where the control is refused is the whole
 * difference between a disabled switch and a broken one. `hint` is the
 * opposite case: the control is live, and the line says what else it does.
 */
export function ActuatorCard({
  icon,
  title,
  subject,
  detail,
  engaged,
  onChange,
  blocked,
  status,
  action,
  hint,
}: {
  icon: string;
  title: string;
  /** What the switch turns on, in the user's words. */
  subject: string;
  /** The one real fact under it: an address, an SNI. */
  detail: string;
  engaged: boolean;
  onChange: (on: boolean) => void;
  /** Why it cannot be *started*. Never a reason it cannot be stopped. */
  blocked?: string | null;
  /** The word in the corner, and its tone. Follows the stage's real state,
   *  not the switch's position: a tunnel that is up but holding is neither
   *  "engaged" nor "unavailable". */
  status: { label: string; tone: "ok" | "warn" | "bad" | "neutral" };
  /** The way out of `blocked`, e.g. "Set up core". */
  action?: ReactNode;
  /** A quiet fact about what pressing the button will also do, e.g. that
   *  the tunnel's button starts the link first. Not a warning: nothing is
   *  wrong, so it takes no colour, no icon and no box. */
  hint?: string | null;
}) {
  // A running stage is always stoppable. Gating the switch on `blocked`
  // would leave a holding tunnel switched on with no way to switch it off,
  // because the reason it is holding is also the reason it may not start.
  const disabled = !engaged && Boolean(blocked);
  const showBlocked = Boolean(blocked) && !engaged;
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Icon
            name={icon}
            size={16}
            className={
              status.tone === "ok"
                ? "text-ok"
                : status.tone === "warn"
                  ? "text-warn"
                  : status.tone === "bad"
                    ? "text-bad"
                    : "text-t3"
            }
          />
          <h3 className="truncate text-row font-semibold text-t1">{title}</h3>
        </div>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>

      {showBlocked ? (
        <div className="flex items-center gap-3 rounded-md border border-warn-line bg-warn-soft px-3 py-[10px]">
          <Icon name="warning" size={16} className="shrink-0 text-warn" />
          <p className="min-w-0 flex-1 text-body text-t1">{blocked}</p>
          {action}
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className={`truncate text-row ${disabled ? "text-t3" : "text-t1"}`}>{subject}</p>
          <p className="mono mt-[2px] truncate text-note text-t3" dir="ltr">
            {detail}
          </p>
          {hint ? <p className="mt-[2px] truncate text-note text-t3">{hint}</p> : null}
        </div>
        <PowerButton
          engaged={engaged}
          tone={status.tone === "neutral" ? "off" : status.tone}
          disabled={disabled}
          title={disabled ? (blocked ?? undefined) : undefined}
          label={`${title}: ${engaged ? "on" : "off"}`}
          onClick={() => onChange(!engaged)}
        />
      </div>
    </div>
  );
}
