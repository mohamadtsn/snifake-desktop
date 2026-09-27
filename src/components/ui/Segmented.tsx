import { Toggle as BaseToggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";

const SIZES = {
  md: "h-[26px] px-[12px] text-body",
  sm: "h-[22px] px-[10px] text-note",
} as const;

/**
 * One of N, as a track with a thumb: the tab bar, the rule-list switcher, the
 * verbosity control and the import sheet's two tabs are all this component.
 *
 * Base UI's `ToggleGroup` rather than a row of buttons, for the keyboard:
 * it gives the group a single tab stop and moves between segments with the
 * arrow keys, which is what a user who has landed on a segmented control
 * expects and what a row of buttons cannot do.
 *
 * `role` exists because the same geometry does two semantic jobs. The top tab
 * bar switches visible panels, so it is a `tablist`; everything else picks a
 * value, and `radiogroup` is what a screen reader should announce for that.
 */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = "md",
  className,
  label,
  role = "radiogroup",
  stretch = false,
}: {
  value: T;
  onChange: (v: T) => void;
  options: {
    value: T;
    label: string;
    badge?: string | number;
    /** Marks the badge, and only the badge: the segment still reads
     *  normally, because the segment is not the thing that is wrong. */
    badgeTone?: "bad" | "warn";
    disabled?: boolean;
  }[];
  size?: "sm" | "md";
  className?: string;
  label?: string;
  role?: "radiogroup" | "tablist";
  /** Fill the width, with every segment the same size. For a control that
   *  owns its row: unequal segments there read as a ragged edge. */
  stretch?: boolean;
}) {
  const itemRole = role === "tablist" ? "tab" : "radio";
  return (
    <ToggleGroup
      value={[value]}
      // A segmented control cannot be empty. Pressing the already-pressed
      // segment clears the group's value, and the answer to that is to keep
      // the current one rather than to render a control with nothing chosen.
      onValueChange={(next) => {
        const picked = next[0] as T | undefined;
        if (picked && picked !== value) onChange(picked);
      }}
      role={role}
      aria-label={label}
      className={`${
        stretch ? "flex w-full" : "inline-flex shrink-0"
      } items-center gap-[2px] rounded-md border border-hairline bg-inset p-[3px]${
        className ? ` ${className}` : ""
      }`}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <BaseToggle
            key={option.value}
            value={option.value}
            disabled={option.disabled}
            role={itemRole}
            aria-selected={role === "tablist" ? active : undefined}
            className={`${
              stretch ? "flex flex-1 basis-0" : "inline-flex"
            } items-center justify-center gap-[6px] rounded-sm font-medium whitespace-nowrap transition-[color,background-color,box-shadow] duration-(--dur-fast) ease-(--ease-out) ${
              SIZES[size]
            } ${
              active
                ? "bg-raised text-t1 shadow-lift shadow-specular-strong"
                : "text-t2 hover:text-t1"
            } disabled:cursor-default disabled:text-t4 disabled:hover:text-t4`}
          >
            {option.label}
            {option.badge !== undefined && option.badge !== "" ? (
              <span
                className={`mono text-mini ${
                  option.badgeTone === "bad"
                    ? "text-bad"
                    : option.badgeTone === "warn"
                      ? "text-warn"
                      : active
                        ? "text-t3"
                        : "text-t4"
                }`}
              >
                {option.badge}
              </span>
            ) : null}
          </BaseToggle>
        );
      })}
    </ToggleGroup>
  );
}
