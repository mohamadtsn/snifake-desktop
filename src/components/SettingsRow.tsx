import { Switch } from "@/components/ui/switch";

export function SettingsRow({
  autostart,
  onAutostartToggle,
}: {
  autostart: boolean;
  onAutostartToggle: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between px-1 pt-0.5">
      <div className="flex flex-col gap-0.5">
        <span className="text-[12.5px] text-text">Launch at login</span>
        <span className="text-[10.5px] text-faint">Start SNI Spoof when you sign in</span>
      </div>
      <Switch checked={autostart} onCheckedChange={onAutostartToggle} />
    </div>
  );
}
