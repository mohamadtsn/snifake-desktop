import { forwardRef, useImperativeHandle, useState } from "react";
import { Input } from "@/components/ui/input";
import { Disclosure } from "@/components/Disclosure";
import { Config } from "@/types";

export interface ConfigFormHandle {
  getValue(): Config;
  validate(): { valid: boolean; error: string };
}

function isValidIp(value: string): boolean {
  const parts = value.split(".");
  if (parts.length !== 4) return false;
  return parts.every((p) => {
    if (!/^\d{1,3}$/.test(p)) return false;
    const n = Number(p);
    return n >= 0 && n <= 255;
  });
}

const fieldClass =
  "h-8 rounded-[9px] border-hairline bg-sunken px-2.5 text-right font-mono text-[12px] text-text " +
  "transition-colors duration-150 focus-visible:border-brand/70 focus-visible:ring-0";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <label className="text-[12.5px] text-dim">{label}</label>
      <div className="w-[164px]">{children}</div>
    </div>
  );
}

export const ConnectionSection = forwardRef<
  ConfigFormHandle,
  {
    initial: Config;
    saved: Config;
    onSave: () => void;
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }
>(function ConnectionSection({ initial, saved, onSave, open, onOpenChange }, ref) {
  const [host, setHost] = useState(initial.LISTEN_HOST);
  const [listenPort, setListenPort] = useState(String(initial.LISTEN_PORT));
  const [connectIp, setConnectIp] = useState(initial.CONNECT_IP);
  const [connectPort, setConnectPort] = useState(String(initial.CONNECT_PORT));
  const [sni, setSni] = useState(initial.FAKE_SNI);

  useImperativeHandle(ref, () => ({
    getValue: () => ({
      LISTEN_HOST: host.trim(),
      LISTEN_PORT: Number(listenPort),
      CONNECT_IP: connectIp.trim(),
      CONNECT_PORT: Number(connectPort),
      FAKE_SNI: sni.trim(),
    }),
    validate: () => {
      if (!host.trim()) return { valid: false, error: "Listen Host cannot be empty." };
      if (!connectIp.trim()) return { valid: false, error: "Connect IP cannot be empty." };
      if (!isValidIp(connectIp.trim())) {
        return {
          valid: false,
          error: `Connect IP '${connectIp.trim()}' is not a valid IP address.`,
        };
      }
      if (!sni.trim()) return { valid: false, error: "Fake SNI cannot be empty." };
      return { valid: true, error: "" };
    },
  }));

  // Save is not a permanent button competing with the primary action — it
  // only exists once there is actually something to save.
  const dirty =
    host.trim() !== saved.LISTEN_HOST ||
    Number(listenPort) !== saved.LISTEN_PORT ||
    connectIp.trim() !== saved.CONNECT_IP ||
    Number(connectPort) !== saved.CONNECT_PORT ||
    sni.trim() !== saved.FAKE_SNI;

  return (
    <Disclosure
      label="Connection"
      summary={`${saved.LISTEN_HOST}:${saved.LISTEN_PORT} → ${saved.CONNECT_PORT}`}
      open={open}
      onOpenChange={onOpenChange}
    >
      <div className="flex flex-col">
        <Row label="Listen host">
          <Input value={host} onChange={(e) => setHost(e.target.value)} className={fieldClass} />
        </Row>
        <Row label="Listen port">
          <Input
            type="number"
            min={1}
            max={65535}
            value={listenPort}
            onChange={(e) => setListenPort(e.target.value)}
            className={fieldClass}
          />
        </Row>

        <div className="my-2 h-px bg-hairline" />

        <Row label="Connect IP">
          <Input
            value={connectIp}
            onChange={(e) => setConnectIp(e.target.value)}
            className={fieldClass}
          />
        </Row>
        <Row label="Connect port">
          <Input
            type="number"
            min={1}
            max={65535}
            value={connectPort}
            onChange={(e) => setConnectPort(e.target.value)}
            className={fieldClass}
          />
        </Row>

        <div className="my-2 h-px bg-hairline" />

        <Row label="Fake SNI">
          <Input value={sni} onChange={(e) => setSni(e.target.value)} className={fieldClass} />
        </Row>

        {dirty && (
          <button
            onClick={onSave}
            className="mt-3 h-8 w-full rounded-[9px] bg-brand/16 text-[12.5px] font-medium text-brand transition-colors duration-150 hover:bg-brand/24 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
          >
            Save changes
          </button>
        )}
      </div>
    </Disclosure>
  );
});
