import { forwardRef, useId, useImperativeHandle, useState } from "react";
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

/**
 * Host and port are one address, so they share a line with the port narrow —
 * the shape of the control mirrors the shape of the value. Every field keeps
 * a visible label; a placeholder is an example, not a label.
 */
function Field({
  label,
  value,
  onChange,
  numeric,
  placeholder,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  numeric?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={`flex min-w-0 flex-col gap-1.5 ${className ?? ""}`}>
      <label htmlFor={id} className="text-[10.5px] tracking-[0.04em] text-faint uppercase">
        {label}
      </label>
      <input
        id={id}
        // Values are hostnames, IPs and ports — always LTR and left-read,
        // whatever the surrounding UI language happens to be.
        dir="ltr"
        inputMode={numeric ? "numeric" : "text"}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={[
          "h-9 w-full rounded-[10px] border border-hairline bg-sunken px-2.5",
          "text-left font-mono text-[12.5px] text-text placeholder:text-faint/55",
          "transition-[border-color,box-shadow] duration-150",
          "[transition-timing-function:var(--ease-out-quint)]",
          "hover:border-hairline-strong",
          "focus:border-brand/70 focus:outline-none",
          "focus:shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-brand)_18%,transparent)]",
        ].join(" ")}
      />
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
    <Disclosure label="Connection" open={open} onOpenChange={onOpenChange}>
      <div className="flex flex-col gap-3">
        <div className="flex gap-2">
          <Field
            label="Listen host"
            value={host}
            onChange={setHost}
            placeholder="127.0.0.1"
            className="flex-1"
          />
          <Field
            label="Port"
            value={listenPort}
            onChange={setListenPort}
            numeric
            placeholder="40443"
            className="w-[78px] shrink-0"
          />
        </div>

        <div className="flex gap-2">
          <Field
            label="Upstream IP"
            value={connectIp}
            onChange={setConnectIp}
            placeholder="0.0.0.0"
            className="flex-1"
          />
          <Field
            label="Port"
            value={connectPort}
            onChange={setConnectPort}
            numeric
            placeholder="443"
            className="w-[78px] shrink-0"
          />
        </div>

        <Field label="Fake SNI" value={sni} onChange={setSni} placeholder="example.com" />

        {dirty && (
          <button
            onClick={onSave}
            className="h-9 w-full rounded-[10px] bg-brand/16 text-[12.5px] font-medium text-brand transition-[background-color,transform] duration-150 [transition-timing-function:var(--ease-out-quint)] hover:bg-brand/24 active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
          >
            Save changes
          </button>
        )}
      </div>
    </Disclosure>
  );
});
