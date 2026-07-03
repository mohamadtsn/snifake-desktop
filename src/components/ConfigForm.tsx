import { forwardRef, useImperativeHandle, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
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

export const ConfigForm = forwardRef<ConfigFormHandle, { initial: Config }>(
  function ConfigForm({ initial }, ref) {
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

    const row = (label: string, field: React.ReactNode) => (
      <div className="flex items-center gap-2">
        <Label className="w-24 shrink-0 text-[13px] text-text-dim">{label}</Label>
        {field}
      </div>
    );

    return (
      <div className="glass-panel space-y-4 p-4">
        <div className="text-[13px] font-semibold text-text-dim">Proxy Configuration</div>

        <div className="space-y-2">
          {row(
            "Listen Host:",
            <Input value={host} onChange={(e) => setHost(e.target.value)} className="h-8 bg-surface-light text-text" />
          )}
          {row(
            "Listen Port:",
            <Input
              type="number"
              min={1}
              max={65535}
              value={listenPort}
              onChange={(e) => setListenPort(e.target.value)}
              className="h-8 bg-surface-light text-text"
            />
          )}
        </div>

        <Separator className="bg-white/10" />

        <div className="space-y-2">
          {row(
            "Connect IP:",
            <Input value={connectIp} onChange={(e) => setConnectIp(e.target.value)} className="h-8 bg-surface-light text-text" />
          )}
          {row(
            "Connect Port:",
            <Input
              type="number"
              min={1}
              max={65535}
              value={connectPort}
              onChange={(e) => setConnectPort(e.target.value)}
              className="h-8 bg-surface-light text-text"
            />
          )}
        </div>

        <Separator className="bg-white/10" />

        {row(
          "Fake SNI:",
          <Input value={sni} onChange={(e) => setSni(e.target.value)} className="h-8 bg-surface-light text-text" />
        )}
      </div>
    );
  }
);