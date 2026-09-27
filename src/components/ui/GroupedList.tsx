import type { ReactNode } from "react";
import { Icon } from "./Icon";

/**
 * The macOS System Settings list: one inset group, a hairline between rows,
 * no border between a row and the group's own edge.
 *
 * A group rather than a card per setting because these rows are a *list of
 * one kind of thing*, and a stack of separate cards would claim they were
 * unrelated. The section label above the group is what says what the kind is.
 *
 * **The separator belongs to the row, not to the group.** It was
 * `[&>*+*]:border-t` on the container, which draws full-bleed lines that cut
 * the group into a table. Owned by the row it can start where the row's text
 * starts, which is what makes a list read as a list - and it is what System
 * Settings itself does.
 */
export function GroupedList({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`overflow-hidden rounded-lg border border-hairline bg-card shadow-specular${
        className ? ` ${className}` : ""
      }`}
    >
      {children}
    </div>
  );
}

/**
 * `title` is the setting. `subtitle` is what it does, when that is not
 * obvious from four words. `badge` qualifies the title in place - "TRAY
 * MODE" beside "Close Window Minimizes to Menu Bar" - and `control` is the
 * one thing on the row that can be operated.
 *
 * `on` tints the icon with the accent. It is not decoration: it is what
 * makes a group of switches read as *state* at a glance rather than as a
 * column of sentences each with a control beside it.
 */
function Row({
  icon,
  title,
  subtitle,
  badge,
  control,
  on,
}: {
  icon?: string;
  title: string;
  subtitle?: string;
  badge?: ReactNode;
  control: ReactNode;
  /** This row's setting is on. Tints the icon; ignored without an `icon`. */
  on?: boolean;
}) {
  return (
    <div
      // `px-4` (16) + icon (16) + `gap-3` (12) = 44. Without an icon the text
      // starts at 16, and the line has to start there too or it would float
      // away from the column it is separating.
      className={`relative flex min-h-[40px] items-center gap-3 px-4 py-[10px] transition-colors duration-(--dur-fast) ease-(--ease-out) hover:bg-raised-dim/40 before:absolute before:top-0 before:right-0 before:h-px before:bg-hairline first:before:hidden ${
        icon ? "before:left-[44px]" : "before:left-4"
      }`}
    >
      {icon ? <Icon name={icon} size={16} className={on ? "text-accent" : "text-t3"} /> : null}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-row font-medium text-t1">{title}</span>
          {badge}
        </div>
        {subtitle ? (
          <p className="mt-[1px] text-note leading-[16.5px] text-t2">{subtitle}</p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center">{control}</div>
    </div>
  );
}

GroupedList.Row = Row;
