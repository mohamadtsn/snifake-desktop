import { Switch as SwitchPrimitive } from "@base-ui/react/switch";

import { cn } from "@/lib/utils";

function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "relative inline-flex h-[24px] w-[42px] shrink-0 cursor-pointer items-center rounded-full",
        "border border-hairline-strong bg-white/6 p-[2px] transition-colors duration-200",
        "[transition-timing-function:var(--ease-out-quint)]",
        "data-checked:border-transparent data-checked:bg-brand",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "size-[18px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.35)]",
          // Slight overshoot: this is a committed, physical toggle.
          "transition-transform duration-200 [transition-timing-function:var(--ease-spring)]",
          "data-checked:translate-x-[18px]"
        )}
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
