import { useId, useState } from "react";
import { Check, ChevronLeft, Trash2 } from "lucide-react";
import { Profile } from "@/types";

function isValidIp(value: string): boolean {
  const parts = value.split(".");
  if (parts.length !== 4) return false;
  return parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) >= 0 && Number(p) <= 255);
}

function isValidPort(value: string): boolean {
  return /^\d{1,5}$/.test(value) && Number(value) >= 1 && Number(value) <= 65535;
}

/**
 * Host and port are one address, so they share a line with the port narrow:
 * the shape of the control mirrors the shape of the value. Every field keeps
 * a visible label; a placeholder is an example, not a label. Values are
 * hostnames, IPs and ports, so the inputs are always LTR and left-read
 * whatever the surrounding UI language is.
 */
function Field({
  label,
  value,
  onChange,
  error,
  numeric,
  placeholder,
  className,
  mono = true,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  numeric?: boolean;
  placeholder?: string;
  className?: string;
  mono?: boolean;
}) {
  const id = useId();
  return (
    <div className={`flex min-w-0 flex-col gap-1.5 ${className ?? ""}`}>
      <label
        htmlFor={id}
        className="text-faint text-[10.5px] uppercase"
        style={{ letterSpacing: "0.05em" }}
      >
        {label}
      </label>
      <input
        id={id}
        dir="ltr"
        inputMode={numeric ? "numeric" : "text"}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        className={[
          "bg-sunken h-10 w-full rounded-[var(--radius-control)] border px-3",
          mono ? "tnum font-mono text-[12.5px]" : "text-[13.5px]",
          "text-text placeholder:text-faint/55 text-left",
          "transition-[border-color,box-shadow] duration-[var(--dur-fast)]",
          "[transition-timing-function:var(--ease-out)]",
          "hover:border-hairline-strong focus:outline-none",
          error
            ? "border-st-error/70 focus:shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-st-error)_20%,transparent)]"
            : "border-hairline focus:border-brand/70 focus:shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-brand)_20%,transparent)]",
        ].join(" ")}
      />
      {error && <span className="text-st-error text-[11px]">{error}</span>}
    </div>
  );
}

export function ProfileEditor({
  profile,
  isNew,
  onCancel,
  onSave,
  onDelete,
}: {
  profile: Profile;
  isNew: boolean;
  onCancel: () => void;
  onSave: (p: Profile) => void;
  onDelete?: () => void;
}) {
  const [name, setName] = useState(profile.name);
  const [host, setHost] = useState(profile.LISTEN_HOST);
  const [listenPort, setListenPort] = useState(String(profile.LISTEN_PORT));
  const [connectIp, setConnectIp] = useState(profile.CONNECT_IP);
  const [connectPort, setConnectPort] = useState(String(profile.CONNECT_PORT));
  const [sni, setSni] = useState(profile.FAKE_SNI);

  const errors = {
    name: name.trim() ? undefined : "Required.",
    host: isValidIp(host.trim()) ? undefined : "Must be an IPv4 address.",
    listenPort: isValidPort(listenPort) ? undefined : "1 to 65535.",
    connectIp: isValidIp(connectIp.trim()) ? undefined : "Must be an IPv4 address.",
    connectPort: isValidPort(connectPort) ? undefined : "1 to 65535.",
    sni: sni.trim() ? undefined : "Required.",
  };
  const valid = Object.values(errors).every((e) => e === undefined);

  function save() {
    if (!valid) return;
    onSave({
      id: profile.id,
      name: name.trim(),
      LISTEN_HOST: host.trim(),
      LISTEN_PORT: Number(listenPort),
      CONNECT_IP: connectIp.trim(),
      CONNECT_PORT: Number(connectPort),
      FAKE_SNI: sni.trim(),
    });
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-2 px-3 pb-3">
        <button
          type="button"
          onClick={onCancel}
          className="text-brand focus-visible:ring-brand/60 flex h-8 items-center gap-0.5 rounded-[10px] pr-2 pl-1 text-[13px] transition-transform duration-[var(--dur-press)] [transition-timing-function:var(--ease-out)] focus-visible:ring-2 focus-visible:outline-none active:scale-[0.97]"
        >
          <ChevronLeft className="size-4" />
          Back
        </button>
        <span className="text-text flex-1 text-center text-[13px] font-semibold">
          {isNew ? "New profile" : "Edit profile"}
        </span>
        {/* bg-brand-press, not bg-brand: white on #0a84ff is 3.65:1 and this
            label is 13px. See DESIGN.md, decision log, 2026-08-27. */}
        <button
          type="button"
          onClick={save}
          disabled={!valid}
          className="bg-brand-press focus-visible:ring-brand/60 flex h-8 items-center gap-1 rounded-[10px] px-3 text-[13px] font-medium text-white transition-[transform,opacity] duration-[var(--dur-press)] [transition-timing-function:var(--ease-out)] focus-visible:ring-2 focus-visible:outline-none active:scale-[0.97] disabled:opacity-35"
        >
          <Check className="size-3.5" />
          Save
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-4 pb-4">
        <Field
          label="Name"
          value={name}
          onChange={setName}
          error={errors.name}
          mono={false}
          placeholder="Vercel"
        />

        <div className="flex gap-2">
          <Field
            label="Listen host"
            value={host}
            onChange={setHost}
            error={errors.host}
            placeholder="127.0.0.1"
            className="flex-1"
          />
          <Field
            label="Port"
            value={listenPort}
            onChange={setListenPort}
            error={errors.listenPort}
            numeric
            placeholder="40443"
            className="w-[84px] shrink-0"
          />
        </div>

        <div className="flex gap-2">
          <Field
            label="Upstream IP"
            value={connectIp}
            onChange={setConnectIp}
            error={errors.connectIp}
            placeholder="104.18.4.130"
            className="flex-1"
          />
          <Field
            label="Port"
            value={connectPort}
            onChange={setConnectPort}
            error={errors.connectPort}
            numeric
            placeholder="443"
            className="w-[84px] shrink-0"
          />
        </div>

        <Field
          label="Fake SNI"
          value={sni}
          onChange={setSni}
          error={errors.sni}
          placeholder="security.vercel.com"
        />

        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="bg-st-error/12 text-st-error hover:bg-st-error/20 focus-visible:ring-st-error/60 mt-1 flex h-10 items-center justify-center gap-2 rounded-[var(--radius-control)] text-[13px] font-medium transition-[background-color,transform] duration-[var(--dur-press)] [transition-timing-function:var(--ease-out)] focus-visible:ring-2 focus-visible:outline-none active:scale-[0.985]"
          >
            <Trash2 className="size-3.5" />
            Delete profile
          </button>
        )}
      </div>
    </div>
  );
}
