import { useState } from "react";
import { Select } from "@base-ui/react/select";
import { invoke } from "@tauri-apps/api/core";
import { Field } from "@/components/Field";
import type { Protocol, TunnelProfile } from "@/types";

const FINGERPRINTS = ["chrome", "firefox", "safari", "ios", "edge", "random"];

interface ImportResult {
  profile: TunnelProfile;
  warnings: string[];
  source_address: string;
  source_port: number;
}

/**
 * One tunnel's fields. Deliberately the same control vocabulary as
 * `ProfileEditor` — same `Field`, imported rather than copied, so the two
 * cannot drift into looking like they were built at different times.
 *
 * The credential's label follows the protocol, because a VLESS UUID and a
 * Trojan password are the same slot with different rules, and one field
 * labelled "credential" would explain neither.
 */
export function TunnelEditor({
  profile,
  isNew,
  listen,
  connectIp,
  onCancel,
  onSave,
  onDelete,
  onAdoptAddress,
}: {
  profile: TunnelProfile;
  isNew: boolean;
  /** The running SNI profile's listener. Shown, never edited. */
  listen: { host: string; port: number } | null;
  /** The active SNI profile's upstream, for the import reconciliation note. */
  connectIp: string | null;
  onCancel: () => void;
  onSave: (t: TunnelProfile) => void;
  onDelete?: () => void;
  /** Writes an imported link's address onto the active SNI profile. */
  onAdoptAddress: (ip: string, port: number) => void;
}) {
  const [name, setName] = useState(profile.name);
  const [protocol, setProtocol] = useState<Protocol>(profile.protocol);
  const [credential, setCredential] = useState(profile.credential);
  const [remoteHost, setRemoteHost] = useState(profile.remote_host);
  const [path, setPath] = useState(profile.path);
  const [sni, setSni] = useState(profile.sni);
  // Tracks whether SNI has been touched. Until it has, it follows the
  // remote host, which is what it equals in every correct configuration we
  // accept — but a user who edits it must not have their edit overwritten.
  const [sniTouched, setSniTouched] = useState(profile.sni !== profile.remote_host);
  const [alpn, setAlpn] = useState(profile.alpn.join(", "));
  const [fingerprint, setFingerprint] = useState(profile.fingerprint);
  const [allowInsecure, setAllowInsecure] = useState(profile.allow_insecure);

  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [mismatch, setMismatch] = useState<{ ip: string; port: number } | null>(null);
  const [copied, setCopied] = useState(false);

  const alpnList = alpn
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");

  const errors = {
    name: name.trim() ? undefined : "Required.",
    credential: credential.trim() ? undefined : "Required.",
    remoteHost: !remoteHost.trim()
      ? "Required."
      : /[/:]/.test(remoteHost.trim())
        ? "Host only, no scheme or path."
        : undefined,
    sni: sni.trim() ? undefined : "Required.",
    alpn:
      alpnList.length === 0
        ? "At least one entry."
        : alpn.split(",").some((s) => s.trim() === "")
          ? "One entry has no value."
          : undefined,
  };
  const valid = Object.values(errors).every((e) => e === undefined);

  function setHost(v: string) {
    setRemoteHost(v);
    // The SNI equals the remote host in every configuration this app
    // accepts, so it follows along until someone says otherwise.
    if (!sniTouched) setSni(v);
  }

  function save() {
    if (!valid) return;
    onSave({
      id: profile.id,
      name: name.trim(),
      protocol,
      credential: credential.trim(),
      remote_host: remoteHost.trim(),
      // Corrected rather than rejected: a missing slash is a typo with one
      // obvious repair, and refusing it would be pedantry.
      path: path.trim().startsWith("/") ? path.trim() : `/${path.trim()}`,
      sni: sni.trim(),
      alpn: alpnList,
      fingerprint,
      allow_insecure: allowInsecure,
    });
  }

  async function runImport() {
    setImportError(null);
    setWarnings([]);
    setMismatch(null);
    try {
      const got = await invoke<ImportResult>("import_tunnel", { text: importText });
      const p = got.profile;
      setName(p.name || name);
      setProtocol(p.protocol);
      setCredential(p.credential);
      setRemoteHost(p.remote_host);
      setPath(p.path);
      setSni(p.sni);
      setSniTouched(p.sni !== p.remote_host);
      setAlpn(p.alpn.join(", "));
      setFingerprint(p.fingerprint);
      setAllowInsecure(p.allow_insecure);
      setWarnings(got.warnings);
      // The link carries an address this app never stores. It is still
      // worth one sentence: if it disagrees with the SNI profile the
      // tunnel will run through, the user is about to reach a different
      // server than the one they were given.
      if (connectIp && got.source_address && got.source_address !== connectIp) {
        setMismatch({ ip: got.source_address, port: got.source_port });
      }
      setImportOpen(false);
      setImportText("");
    } catch (e) {
      setImportError(String(e));
    }
  }

  async function copyLink() {
    try {
      const uri = await invoke<string>("export_tunnel_uri", { id: profile.id });
      await navigator.clipboard.writeText(uri);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch (e) {
      setImportError(String(e));
    }
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
        {/* A greyed reading, not a greyed input: a disabled field invites
            people to look for the way to enable it. */}
        <div className="mb-3 flex flex-col gap-1.5">
          <span
            className="text-faint text-[9.5px] uppercase"
            style={{ letterSpacing: "var(--track-engrave)" }}
          >
            Destination
          </span>
          <span dir="ltr" className="text-dim text-left text-[12px] leading-none">
            {listen ? `${listen.host}:${listen.port}` : "No SNI profile is active"}
          </span>
          <span className="text-faint prose-face text-[10.5px] leading-relaxed">
            From the active SNI profile. The tunnel always connects through it, so this
            cannot be set by hand.
          </span>
        </div>

        <Field
          label="Name"
          value={name}
          onChange={setName}
          error={errors.name}
          placeholder="de-01"
        />

        <div className="flex flex-col gap-1.5">
          <label
            className="text-faint text-[9.5px] uppercase"
            style={{ letterSpacing: "var(--track-engrave)" }}
          >
            Protocol
          </label>
          <Select.Root value={protocol} onValueChange={(v) => setProtocol(v as Protocol)}>
            <Select.Trigger className="selector">
              <span className="flex-1 text-left text-[12.5px]">
                {protocol === "vless" ? "VLESS" : "Trojan"}
              </span>
              <Select.Icon className="text-faint shrink-0 text-[9px]">▼</Select.Icon>
            </Select.Trigger>
            <Select.Portal>
              <Select.Positioner
                sideOffset={4}
                alignItemWithTrigger={false}
                className="z-50 outline-none"
              >
                <Select.Popup className="menu">
                  <Select.Item value="vless" className="menu-item">
                    <Select.ItemText className="flex-1 text-[12px]">VLESS</Select.ItemText>
                  </Select.Item>
                  <Select.Item value="trojan" className="menu-item">
                    <Select.ItemText className="flex-1 text-[12px]">Trojan</Select.ItemText>
                  </Select.Item>
                </Select.Popup>
              </Select.Positioner>
            </Select.Portal>
          </Select.Root>
          <span className="h-[11px]" />
        </div>

        <Field
          label={protocol === "vless" ? "UUID" : "Password"}
          value={credential}
          onChange={setCredential}
          error={errors.credential}
          placeholder={
            protocol === "vless" ? "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d" : "your-password"
          }
        />

        <Field
          label="Remote host"
          value={remoteHost}
          onChange={setHost}
          error={errors.remoteHost}
          placeholder="origin.cdn-domain.com"
        />

        <Field label="Path" value={path} onChange={setPath} placeholder="/websocket" />

        <Field
          label="SNI"
          value={sni}
          onChange={(v) => {
            setSniTouched(true);
            setSni(v);
          }}
          error={errors.sni}
          placeholder="origin.cdn-domain.com"
        />

        <Field
          label="ALPN"
          value={alpn}
          onChange={setAlpn}
          error={errors.alpn}
          placeholder="h3, h2, http/1.1"
        />

        <div className="flex flex-col gap-1.5">
          <label
            className="text-faint text-[9.5px] uppercase"
            style={{ letterSpacing: "var(--track-engrave)" }}
          >
            Fingerprint
          </label>
          <Select.Root value={fingerprint} onValueChange={(v) => setFingerprint(v ?? "chrome")}>
            <Select.Trigger className="selector">
              <span className="flex-1 text-left text-[12.5px]">{fingerprint}</span>
              <Select.Icon className="text-faint shrink-0 text-[9px]">▼</Select.Icon>
            </Select.Trigger>
            <Select.Portal>
              <Select.Positioner
                sideOffset={4}
                alignItemWithTrigger={false}
                className="z-50 outline-none"
              >
                <Select.Popup className="menu">
                  {FINGERPRINTS.map((f) => (
                    <Select.Item key={f} value={f} className="menu-item">
                      <Select.ItemText className="flex-1 text-[12px]">{f}</Select.ItemText>
                    </Select.Item>
                  ))}
                </Select.Popup>
              </Select.Positioner>
            </Select.Portal>
          </Select.Root>
          <span className="h-[11px]" />
        </div>

        <label className="mb-1 flex cursor-pointer items-start gap-2.5">
          <input
            type="checkbox"
            className="mt-0.5 size-3 shrink-0 rounded-[2px] accent-[var(--color-live)]"
            checked={allowInsecure}
            onChange={(e) => setAllowInsecure(e.target.checked)}
          />
          <span className="min-w-0 flex-1">
            <span className="text-text block text-[12px] leading-none">Allow insecure</span>
            <span className="text-faint prose-face mt-1.5 block text-[10.5px] leading-relaxed">
              Disables certificate checking. Leave off unless you know why you are turning it
              on.
            </span>
          </span>
        </label>

        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setImportOpen((v) => !v)}
            className="chip h-8 flex-1"
          >
            {importOpen ? "Cancel import" : "Import"}
          </button>
          <button
            type="button"
            onClick={() => void copyLink()}
            disabled={isNew}
            className="chip h-8 flex-1 disabled:opacity-30"
          >
            {copied ? "Copied" : "Copy link"}
          </button>
        </div>

        {importOpen && (
          <div className="mt-2 flex flex-col gap-1.5">
            <textarea
              dir="ltr"
              spellCheck={false}
              rows={3}
              autoFocus
              placeholder="vless://… or trojan://… or an Xray JSON outbound"
              className="inset text-text placeholder:text-ghost min-h-[64px] w-full resize-y px-2.5 py-2 text-left text-[11.5px] leading-relaxed transition-[border-color] duration-[var(--dur-fast)] [transition-timing-function:var(--ease-out)] hover:border-edge focus:border-live focus:outline-none"
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
            />
            <button
              type="button"
              onClick={() => void runImport()}
              disabled={importText.trim() === ""}
              className="chip h-8 disabled:opacity-30"
            >
              Fill the form from this
            </button>
          </div>
        )}

        {importError && (
          <p role="alert" className="text-st-error prose-face mt-2 text-[11px] leading-relaxed">
            {importError}
          </p>
        )}

        {warnings.map((w) => (
          <p key={w} className="text-dim prose-face mt-2 text-[11px] leading-relaxed">
            {w}
          </p>
        ))}

        {mismatch && (
          <div className="border-line mt-2 flex flex-col gap-2 border-t pt-2">
            <p className="text-dim prose-face text-[11px] leading-relaxed">
              This link points at <span dir="ltr">{mismatch.ip}:{mismatch.port}</span>, but the
              active SNI profile connects to <span dir="ltr">{connectIp}</span>. The tunnel
              follows the profile, so it will not reach the server this link names.
            </p>
            <button
              type="button"
              onClick={() => {
                onAdoptAddress(mismatch.ip, mismatch.port);
                setMismatch(null);
              }}
              className="chip h-8"
            >
              Point the SNI profile at {mismatch.ip}
            </button>
          </div>
        )}

        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="border-st-error/35 text-st-error hover:bg-st-error/12 hover:border-st-error/60 mt-3 h-9 rounded-[var(--radius-control)] border text-[10px] uppercase transition-colors duration-[var(--dur-fast)] focus-visible:outline-none"
            style={{ letterSpacing: "var(--track-engrave)" }}
          >
            Delete tunnel
          </button>
        )}
      </div>
    </div>
  );
}
