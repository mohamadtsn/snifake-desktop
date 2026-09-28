import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";

/**
 * Shown when a TUN session ended without taking its kill switch down — a
 * crash, a kill, a power cut. Fail-closed is the design, so the machine is
 * offline on purpose; this is what makes that survivable instead of
 * mysterious.
 *
 * Restore network is the recommended action (it asks for the password once
 * and opens the network); Resume tunnel is the alternative for someone who
 * wants the protection back rather than the network.
 */
export function RecoveryBanner({
  restoring,
  onRestore,
  onResume,
}: {
  restoring: boolean;
  onRestore: () => void;
  onResume: () => void;
}) {
  return (
    <div role="alert" className="flex gap-3 rounded-md border border-warn-line bg-warn-soft px-3 py-3">
      <Icon name="block" size={18} className="mt-[1px] shrink-0 text-warn" />
      <div className="min-w-0 flex-1">
        <p className="text-body font-semibold text-t1">
          Network is still blocked from the last session.
        </p>
        <p className="mt-[2px] text-note text-t2">
          The tunnel stopped without taking its firewall rules with it, so nothing on this computer
          can reach the internet.
        </p>
        <div className="mt-3 flex gap-2">
          <Button variant="primary" size="sm" onClick={onRestore} disabled={restoring}>
            {restoring ? "Restoring…" : "Restore network"}
          </Button>
          <Button variant="secondary" size="sm" onClick={onResume} disabled={restoring}>
            Resume tunnel
          </Button>
        </div>
      </div>
    </div>
  );
}
