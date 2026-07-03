import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ProxyState } from "@/types";

export function ActionBar(props: {
  state: ProxyState;
  autostart: boolean;
  onStart: () => void;
  onStop: () => void;
  onSave: () => void;
  onExit: () => void;
  onAutostartToggle: (checked: boolean) => void;
}) {
  const startEnabled = props.state === "stopped" || props.state === "error";
  const stopEnabled = props.state === "running" || props.state === "starting";

  return (
    <div className="space-y-2">
      <div className="flex gap-2.5">
        <Button
          disabled={!startEnabled}
          onClick={props.onStart}
          className="h-[40px] flex-1 rounded-xl bg-gradient-to-b from-success-hover to-success font-semibold text-white shadow-lg shadow-success/20 transition-all hover:brightness-110 disabled:from-white/5 disabled:to-white/5 disabled:text-text-dim disabled:shadow-none"
        >
          Start
        </Button>
        <Button
          disabled={!stopEnabled}
          onClick={props.onStop}
          className="h-[40px] flex-1 rounded-xl bg-gradient-to-b from-danger-hover to-danger font-semibold text-white shadow-lg shadow-danger/20 transition-all hover:brightness-110 disabled:from-white/5 disabled:to-white/5 disabled:text-text-dim disabled:shadow-none"
        >
          Stop
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <Button
          onClick={props.onSave}
          className="h-[40px] w-20 rounded-xl bg-gradient-to-b from-primary to-accent font-semibold text-white shadow-lg shadow-primary/20 transition-all hover:brightness-110"
        >
          Save
        </Button>

        <label className="flex items-center gap-2 text-[13px] text-text">
          <Checkbox
            checked={props.autostart}
            onCheckedChange={(checked) => props.onAutostartToggle(checked === true)}
          />
          Autostart
        </label>

        <div className="flex-1" />

        <Button
          onClick={props.onExit}
          className="h-[40px] w-20 rounded-xl border border-white/10 bg-white/5 font-semibold text-text backdrop-blur-md transition-all hover:bg-white/10"
        >
          Exit
        </Button>
      </div>
    </div>
  );
}