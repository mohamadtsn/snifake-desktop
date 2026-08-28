import { useId, useState } from "react";
import { Profile } from "@/types";
import { undoIntent, useUndoHistory } from "@/lib/undo";

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
 * the shape of the control mirrors the shape of the value. Every field
 * keeps a visible label — a placeholder is an example, not a label. Values
 * are hostnames, IPs and ports, so inputs are always LTR and left-read
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
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  numeric?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const id = useId();
  // The field owns its undo stack rather than relying on the webview's —
  // see src/lib/undo.ts for why.
  const history = useUndoHistory(value);

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const intent = undoIntent(e);
    if (!intent) return;
    const restored = intent === "undo" ? history.undo() : history.redo();
    // Nothing of ours to restore: leave the event alone so the platform
    // still gets its shot at it.
    if (restored === undefined) return;
    e.preventDefault();
    onChange(restored);
  }

  return (
    <div className={`flex min-w-0 flex-col gap-1.5 ${className ?? ""}`}>
      <label
        htmlFor={id}
        className="text-faint text-[9.5px] uppercase"
        style={{ letterSpacing: "var(--track-engrave)" }}
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
        onChange={(e) => {
          history.record(e.target.value);
          onChange(e.target.value);
        }}
        onKeyDown={onKeyDown}
        aria-invalid={error ? true : undefined}
        className={[
          "inset text-text placeholder:text-ghost h-9 w-full px-2.5 text-left text-[12px]",
          "transition-[border-color,box-shadow] duration-[var(--dur-fast)]",
          "[transition-timing-function:var(--ease-out)] focus:outline-none",
          error
            ? "border-st-error/70 focus:border-st-error"
            : "hover:border-edge focus:border-live",
        ].join(" ")}
      />
      {/* The message replaces nothing and shifts nothing: the row keeps its
          height whether or not it is in error. */}
      <span className="text-st-error h-[11px] text-[10px] leading-none">{error ?? ""}</span>
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
    host: isValidIp(host.trim()) ? undefined : "IPv4 address.",
    listenPort: isValidPort(listenPort) ? undefined : "1–65535.",
    connectIp: isValidIp(connectIp.trim()) ? undefined : "IPv4 address.",
    connectPort: isValidPort(connectPort) ? undefined : "1–65535.",
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
      <header className="border-line flex shrink-0 items-center gap-2 border-b px-4 pb-3">
        <button
          type="button"
          onClick={onCancel}
          className="text-faint hover:text-text flex items-center gap-1.5 text-[10px] uppercase transition-colors focus-visible:outline-none"
          style={{ letterSpacing: "var(--track-engrave)" }}
        >
          &lsaquo; Back
        </button>
        <h2
          className="text-dim flex-1 text-center text-[10px] uppercase"
          style={{ letterSpacing: "var(--track-engrave)" }}
        >
          {isNew ? "New" : "Edit"}
        </h2>
        {/* Solid green carrying dark ink — the same pairing as the lit power
            switch, and used here for the same reason: this is the one
            committing action on the screen. */}
        <button
          type="button"
          onClick={save}
          disabled={!valid}
          className="chip bg-live text-live-ink border-live hover:bg-live h-7 px-3 disabled:opacity-30"
        >
          Save
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pt-3 pb-4">
        <Field
          label="Name"
          value={name}
          onChange={setName}
          error={errors.name}
          placeholder="cloudflare"
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
            className="w-[78px] shrink-0"
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
            className="w-[78px] shrink-0"
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
            className="border-st-error/35 text-st-error hover:bg-st-error/12 hover:border-st-error/60 mt-3 h-9 rounded-[var(--radius-control)] border text-[10px] uppercase transition-colors duration-[var(--dur-fast)] focus-visible:outline-none"
            style={{ letterSpacing: "var(--track-engrave)" }}
          >
            Delete profile
          </button>
        )}
      </div>
    </div>
  );
}
