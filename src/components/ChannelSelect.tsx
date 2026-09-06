import { Select } from "@base-ui/react/select";

/**
 * The channel selector.
 *
 * This replaced a rail of chips, for two reasons. Switching profiles while
 * the engine is up restarts it, so a single stray click on the main panel
 * was one click away from bouncing a live connection — a selector costs two
 * deliberate actions (open, choose) and cannot be hit by accident. And a
 * chip rail grows with the profile list, so the panel's layout changed
 * depending on how many profiles you happened to have; this occupies one
 * row forever.
 *
 * Base UI's Select supplies the listbox semantics, type-ahead, roving focus
 * and Esc. What is ours is the readout: the trigger shows the route as well
 * as the name, because the name alone does not tell you where traffic goes.
 */
export function ChannelSelect<T extends { id: string; name: string }>({
  items,
  activeId,
  runningId,
  subtitle,
  manageLabel,
  onSelect,
  onManage,
}: {
  items: T[];
  activeId: string | null;
  runningId: string | null;
  /** The line under the name. For a profile it is the route; for a tunnel
   *  it is the protocol and the real destination. Either way it is what
   *  the name alone does not tell you. */
  subtitle: (item: T) => string;
  manageLabel: string;
  onSelect: (id: string) => void;
  onManage: () => void;
}) {
  const active = items.find((p) => p.id === activeId);

  return (
    /* No heading of its own any more: two rows of the same kind of thing
       sit under one CHANNELS rule in App. Two headings would be two rules
       where one belongs. */
    <div className="flex shrink-0 items-stretch gap-2">
        <Select.Root
          value={activeId ?? ""}
          onValueChange={(next) => {
            if (typeof next === "string" && next && next !== activeId) onSelect(next);
          }}
        >
          <Select.Trigger className="selector min-w-0 flex-1">
            <span className="min-w-0 flex-1 text-left">
              <span className="text-text block truncate text-[12.5px] leading-none">
                {active?.name ?? "—"}
              </span>
              {active && (
                <span
                  dir="ltr"
                  className="text-faint mt-1.5 block truncate text-left text-[10px] leading-none"
                >
                  {subtitle(active)}
                </span>
              )}
            </span>
            {/* Lit only while that profile is the one actually carrying
                traffic, which is not always the selected one — selecting
                while stopped changes what Start will run, nothing more. */}
            {runningId === activeId && runningId !== null && (
              <span
                className="text-live shrink-0 text-[8.5px] uppercase"
                style={{ letterSpacing: "var(--track-engrave)" }}
              >
                Live
              </span>
            )}
            <Select.Icon className="text-faint shrink-0 text-[9px]">▼</Select.Icon>
          </Select.Trigger>

          <Select.Portal>
            <Select.Positioner
              sideOffset={4}
              alignItemWithTrigger={false}
              className="z-50 outline-none"
            >
              <Select.Popup className="menu">
                {items.map((p) => (
                  <Select.Item key={p.id} value={p.id} className="menu-item">
                    <span
                      className="menu-mark"
                      data-live={p.id === runningId ? "" : undefined}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">
                      <Select.ItemText className="block truncate text-[12px] leading-none">
                        {p.name}
                      </Select.ItemText>
                      <span
                        dir="ltr"
                        className="text-faint mt-1.5 block truncate text-left text-[9.5px] leading-none"
                      >
                        {subtitle(p)}
                      </span>
                    </span>
                    {/* Neutral, not green. Green means "carrying traffic"
                        everywhere else in the app, and the selected profile
                        is not necessarily the running one. */}
                    <Select.ItemIndicator className="text-dim shrink-0 text-[11px]">
                      ✓
                    </Select.ItemIndicator>
                  </Select.Item>
                ))}
              </Select.Popup>
            </Select.Positioner>
          </Select.Portal>
        </Select.Root>

        <button
          type="button"
          onClick={onManage}
          aria-label={manageLabel}
          title={manageLabel}
          className="selector text-faint hover:text-text w-10 shrink-0 justify-center px-0"
        >
          <svg
            viewBox="0 0 16 16"
            className="size-4"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.3}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M10.4 2.6l3 3L6 13H3v-3z" />
            <path d="M9 4l3 3" />
          </svg>
        </button>
    </div>
  );
}
