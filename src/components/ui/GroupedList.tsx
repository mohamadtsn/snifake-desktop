import type { ReactNode } from "react";
import { Icon } from "./Icon";

/**
 * The macOS System Settings list: one inset group, hairline between rows, no
 * border between a row and the group's own edge.
 *
 * A group rather than a card per setting because these rows are a *list of
 * one kind of thing*, and a stack of separate cards would claim they were
 * unrelated. The section label above the group is what says what the kind is.
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
      className={`overflow-hidden rounded-lg border border-hairline bg-card shadow-specular [&>*+*]:border-t [&>*+*]:border-hairline${
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
 */
function Row({
  icon,
  title,
  subtitle,
  badge,
  control,
}: {
  icon?: string;
  title: string;
  subtitle?: string;
  badge?: ReactNode;
  control: ReactNode;
}) {
  return (
    <div className="flex min-h-[40px] items-center gap-3 px-4 py-[10px]">
      {icon ? <Icon name={icon} size={16} className="text-t3" /> : null}
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
