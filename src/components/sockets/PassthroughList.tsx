import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/Button";
import { GroupedList } from "@/components/ui/GroupedList";
import { Icon } from "@/components/ui/Icon";
import { TextField } from "@/components/ui/TextField";
import { Toggle } from "@/components/ui/Toggle";
import { MAX_PASSTHROUGH, interfaceError, statusLine } from "@/lib/passthrough";
import type { InterfaceCandidate, PassthroughStatus } from "@/types";

/**
 * VPNs that keep working beside TUN. The user names an interface; the
 * engine finds its routes (and, for WireGuard, its server) and keeps both
 * flows out of the tunnel, re-checking every five seconds. Detected
 * interfaces are offered as switches; anything else can be typed.
 */
export function PassthroughList({
  names,
  onChange,
  status,
  tunActive,
}: {
  names: string[];
  onChange: (names: string[]) => void;
  /** The engine's last report, by name. */
  status: PassthroughStatus[];
  tunActive: boolean;
}) {
  const [candidates, setCandidates] = useState<InterfaceCandidate[]>([]);
  const [typed, setTyped] = useState("");

  useEffect(() => {
    void invoke<InterfaceCandidate[]>("list_interfaces").then(setCandidates).catch(() => setCandidates([]));
  }, []);

  const rows = [...new Set([...candidates.map((c) => c.name), ...names])];
  const toggle = (name: string, on: boolean) =>
    onChange(on ? [...names, name] : names.filter((n) => n !== name));
  const typedError = typed ? interfaceError(typed) : null;
  const full = names.length >= MAX_PASSTHROUGH;

  return (
    <section>
      <h2 className="mb-2 px-[2px] text-note font-semibold tracking-[0.55px] text-t2 uppercase">
        Coexisting VPNs (TUN)
      </h2>
      <GroupedList>
        {rows.map((name) => {
          const on = names.includes(name);
          const cand = candidates.find((c) => c.name === name);
          const line = on ? statusLine(status.find((s) => s.name === name), tunActive) : null;
          return (
            <GroupedList.Row
              key={name}
              icon="vpn_key"
              on={on}
              title={`${name}${cand?.kind ? ` · ${cand.kind}` : ""}${cand && !cand.up ? " (down)" : ""}`}
              subtitle={line?.text ?? "Captured by the tunnel like everything else."}
              control={
                <Toggle checked={on} disabled={!on && full} onChange={(v) => toggle(name, v)} aria-label={`Let ${name} bypass the tunnel`} />
              }
            />
          );
        })}
      </GroupedList>
      <div className="mt-2 flex items-end gap-2">
        <div className="flex-1">
          <TextField label="Another interface" value={typed} placeholder="wg0" error={typedError} onChange={(v) => setTyped(v.trim())} />
        </div>
        <Button
          size="sm"
          variant="secondary"
          disabled={!typed || typedError !== null || names.includes(typed) || full}
          onClick={() => { onChange([...names, typed]); setTyped(""); }}
        >
          <Icon name="add" size={13} />
          Add
        </Button>
      </div>
      <p className="mt-2 px-[2px] text-note text-t3">
        OpenVPN and other userspace VPNs send their own traffic from a program; add it to Bypass as
        <span className="mono"> process:openvpn</span> to keep that out of the tunnel too.
      </p>
    </section>
  );
}
