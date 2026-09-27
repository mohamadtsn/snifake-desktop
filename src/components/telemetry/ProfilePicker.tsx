import { Select } from "@base-ui/react/select";
import { Icon } from "@/components/ui/Icon";

/**
 * One labelled selector. Generic over `{id, name}` so the SNI row and the
 * tunnel row are the same component rather than two that drift.
 *
 * A selector rather than a row of chips, for the reason the Console arrived
 * at and this redesign keeps: switching profiles while the engine is running
 * restarts it, and a chip is one stray click away from doing that. A
 * selector costs two deliberate actions.
 */
export function ProfilePicker<T extends { id: string; name: string }>({
  label,
  icon,
  items,
  activeId,
  status,
  statusTone = "text-t3",
  onSelect,
  empty,
}: {
  label: string;
  icon: string;
  items: T[];
  activeId: string | null;
  /** The word beside the label: ACTIVE, MISSING, the running state. */
  status: string;
  statusTone?: string;
  onSelect: (id: string) => void;
  /** What the trigger says when there is nothing to choose. */
  empty: string;
}) {
  const active = items.find((i) => i.id === activeId);
  return (
    <div className="min-w-0 flex-1">
      <div className="mb-[6px] flex items-baseline justify-between gap-2">
        <span className="text-note text-t2">{label}</span>
        <span className={`mono text-micro tracking-[0.04em] uppercase ${statusTone}`}>
          {status}
        </span>
      </div>
      <Select.Root
        value={activeId ?? ""}
        onValueChange={(next) => {
          if (typeof next === "string" && next && next !== activeId) onSelect(next);
        }}
        disabled={items.length === 0}
      >
        <Select.Trigger className="flex h-[32px] w-full items-center gap-2 rounded-md border border-hairline bg-inset px-[10px] text-left transition-[border-color,background-color] duration-(--dur-fast) ease-(--ease-out) hover:border-hairline-strong data-[disabled]:cursor-default data-[disabled]:opacity-60">
          <Icon name={icon} size={14} className={active ? "text-accent" : "text-t3"} />
          <span className={`min-w-0 flex-1 truncate text-body ${active ? "text-t1" : "text-t3"}`}>
            {active?.name ?? empty}
          </span>
          <Select.Icon className="shrink-0 text-t3">
            <Icon name="unfold_more" size={14} />
          </Select.Icon>
        </Select.Trigger>

        <Select.Portal>
          <Select.Positioner sideOffset={4} alignItemWithTrigger={false} className="z-50 outline-none">
            <Select.Popup className="min-w-[var(--anchor-width)] overflow-hidden rounded-md border border-hairline-strong bg-card p-1 shadow-modal">
              {items.map((item) => (
                <Select.Item
                  key={item.id}
                  value={item.id}
                  className="flex cursor-default items-center gap-2 rounded-sm px-2 py-[6px] text-body text-t2 select-none data-[highlighted]:bg-raised data-[highlighted]:text-t1"
                >
                  <Select.ItemIndicator className="shrink-0 text-accent">
                    <Icon name="check" size={13} />
                  </Select.ItemIndicator>
                  <Select.ItemText className="min-w-0 flex-1 truncate">{item.name}</Select.ItemText>
                </Select.Item>
              ))}
            </Select.Popup>
          </Select.Positioner>
        </Select.Portal>
      </Select.Root>
    </div>
  );
}
