import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Segmented } from "@/components/ui/Segmented";
import { StatusDot } from "@/components/ui/StatusDot";
import { TextField } from "@/components/ui/TextField";
import { Toggle } from "@/components/ui/Toggle";
import { FieldRow } from "@/components/ui/FieldRow";
import { listenAddress } from "@/lib/readouts";
import type { Profile, Protocol, TunnelProfile } from "@/types";

const blank = (): TunnelProfile => ({
  id: "",
  name: "",
  protocol: "vless",
  credential: "",
  remote_host: "",
  path: "/",
  sni: "",
  alpn: ["h2", "http/1.1"],
  fingerprint: "chrome",
  allow_insecure: false,
});

/** `remote_port` is not in the model: the tunnel dials the remote over TLS
 *  on 443, and the stored profile carries no port of its own. */
const REMOTE_PORT = 443;

export function TunnelEditorPane({
  tunnel,
  sniProfile,
  isActive,
  isRunning,
  saving,
  onSave,
  onDelete,
  onCopyLink,
}: {
  tunnel: TunnelProfile | null;
  /** The running SNI profile, read live for the ingress panel. */
  sniProfile: Profile | undefined;
  isActive: boolean;
  isRunning: boolean;
  saving: boolean;
  onSave: (t: TunnelProfile) => void;
  onDelete: (id: string) => void;
  onCopyLink: (id: string) => void;
}) {
  const source = tunnel ?? blank();
  const [draft, setDraft] = useState(source);
  const [touched, setTouched] = useState<Set<keyof TunnelProfile>>(new Set());
  const [attempted, setAttempted] = useState(false);

  useEffect(() => {
    setDraft(tunnel ?? blank());
    setTouched(new Set());
    setAttempted(false);
  }, [tunnel]);

  const errors = {
    name: draft.name.trim() ? null : "Give it a name you will recognise.",
    credential:
      draft.credential.trim() === ""
        ? draft.protocol === "vless"
          ? "The UUID from the server."
          : "The password from the server."
        : null,
    remote_host: draft.remote_host.trim() ? null : "The server's hostname.",
    path: draft.path.startsWith("/") ? null : "A WebSocket path, starting with a slash.",
    sni: draft.sni.trim() ? null : "The name presented in the TLS handshake.",
  };
  const valid = Object.values(errors).every((e) => e === null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(source);

  const shown = (key: keyof TunnelProfile, message: string | null) =>
    attempted || touched.has(key) ? message : null;

  const set = (patch: Partial<TunnelProfile>) => {
    setDraft({ ...draft, ...patch });
    setTouched(new Set([...touched, ...(Object.keys(patch) as (keyof TunnelProfile)[])]));
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col rounded-lg border border-hairline bg-card shadow-specular">
      <header className="flex items-center gap-3 border-b border-hairline px-4 py-3">
        <span className="flex size-[32px] shrink-0 items-center justify-center rounded-md border border-accent-line bg-accent-soft text-accent shadow-sunken">
          <Icon name="vpn_lock" size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-row font-semibold text-t1">
              {draft.name.trim() || (tunnel ? "Untitled tunnel" : "New tunnel")}
            </h2>
            {isActive ? <Badge tone="ok">active</Badge> : null}
          </div>
          <p className="mono mt-[1px] truncate text-note text-t3">
            Tunnel egress layer{tunnel ? ` · id ${tunnel.id}` : " · not saved yet"}
          </p>
        </div>
        {tunnel ? (
          <>
            {/* Copy Link exists here and not on the SNI editor, because a
                tunnel has a share-link format and an SNI profile does not. */}
            <Button variant="ghost" size="sm" onClick={() => onCopyLink(tunnel.id)}>
              <Icon name="link" size={14} />
              Copy link
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-bad hover:bg-bad-soft hover:text-bad"
              onClick={() => onDelete(tunnel.id)}
            >
              <Icon name="delete" size={14} />
              Delete
            </Button>
          </>
        ) : null}
      </header>

      <div className="tab-scroll flex min-h-0 flex-1 flex-col gap-1 px-4 pt-3 pb-1">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <TextField
              label="Tunnel identifier name"
              value={draft.name}
              onChange={(v) => set({ name: v })}
              error={shown("name", errors.name)}
              mono={false}
            />
          </div>
          <div className="w-[200px] shrink-0">
            {/* Two protocols, and the set is closed: widening it is a spec
                change, not a code change. See ACCEPTED_V2_CONFIG.md. */}
            <FieldRow label="Protocol architecture" labelled={false}>
              <Segmented
                stretch
                label="Protocol"
                value={draft.protocol}
                onChange={(p: Protocol) => set({ protocol: p })}
                options={[
                  { value: "vless", label: "VLESS" },
                  { value: "trojan", label: "Trojan" },
                ]}
              />
            </FieldRow>
          </div>
        </div>

        <TextField
          label={draft.protocol === "vless" ? "UUID (VLESS auth)" : "Password (Trojan auth)"}
          hint={
            <span className="flex items-center gap-[5px]">
              <Icon name="lock" size={11} />
              carried inside TLS
            </span>
          }
          value={draft.credential}
          onChange={(v) => set({ credential: v })}
          error={shown("credential", errors.credential)}
          icon={<Icon name="key" size={13} />}
          placeholder={draft.protocol === "vless" ? "00000000-0000-0000-0000-000000000000" : "password"}
        />

        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <TextField
              label="Remote host"
              value={draft.remote_host}
              onChange={(v) => set({ remote_host: v })}
              error={shown("remote_host", errors.remote_host)}
              placeholder="tunnel.example.net"
            />
          </div>
          <div className="w-[130px] shrink-0">
            {/* Read-only, and deliberately: the transport is ws over tls,
                which is 443. A field the user can change to something the
                generator will not honour is worse than no field. */}
            <FieldRow label="Remote port" hint="TLS">
              <input
                value={REMOTE_PORT}
                readOnly
                dir="ltr"
                aria-label="Remote port, fixed at 443"
                className="mono h-[32px] w-full cursor-default rounded-md border border-hairline bg-inset px-[10px] text-row text-t3"
              />
            </FieldRow>
          </div>
        </div>

        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <TextField
              label="Path (WebSocket)"
              value={draft.path}
              onChange={(v) => set({ path: v })}
              error={shown("path", errors.path)}
              placeholder="/ws"
            />
          </div>
          <div className="min-w-0 flex-1">
            <TextField
              label="SNI / host header"
              value={draft.sni}
              onChange={(v) => set({ sni: v })}
              error={shown("sni", errors.sni)}
              placeholder="tunnel.example.net"
            />
          </div>
        </div>

        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <TextField
              label="ALPN"
              hint="comma separated"
              value={draft.alpn.join(", ")}
              onChange={(v) =>
                set({ alpn: v.split(",").map((a) => a.trim()).filter((a) => a !== "") })
              }
              placeholder="h2, http/1.1"
            />
          </div>
          <div className="min-w-0 flex-1">
            <TextField
              label="TLS fingerprint"
              value={draft.fingerprint}
              onChange={(v) => set({ fingerprint: v })}
              placeholder="chrome"
            />
          </div>
        </div>

        {/* The read-only panel that says where this tunnel's outbound goes.
            It reads the *running* SNI profile every render rather than
            storing a copy, which is the same reason `address` and `port` are
            absent from the stored tunnel: a stored copy of a read-only field
            eventually disagrees with reality. */}
        <div className="mt-1 flex items-start gap-3 rounded-md border border-accent-line bg-accent-soft px-3 py-[10px]">
          <Icon name="link" size={16} className="mt-[1px] shrink-0 text-accent" />
          <div className="min-w-0">
            <p className="text-note font-medium text-t1">Cascaded ingress target (read-only)</p>
            <p className="mono mt-[3px] text-note leading-[16.5px] text-t2">
              {sniProfile ? (
                <>
                  Dials the active SNI link{" "}
                  <span className="text-t1">{sniProfile.name}</span> at{" "}
                  <span className="text-accent">{listenAddress(sniProfile)}</span>. The address
                  is read from that profile when the config is generated and is never stored
                  here.
                </>
              ) : (
                <>
                  No SNI link is active. The tunnel dials the SNI link&rsquo;s listener, so it
                  cannot start until one exists.
                </>
              )}
            </p>
          </div>
        </div>

        <div className="mt-1 flex items-center justify-between gap-3 rounded-md border border-hairline bg-inset px-3 py-[9px]">
          <div className="min-w-0">
            <p className="text-row text-t1">Allow insecure TLS</p>
            <p className="mt-[1px] text-note leading-[16.5px] text-t2">
              Skips certificate verification. Only for a server with a self-signed certificate,
              and it removes the protection TLS was there to give.
            </p>
          </div>
          <Toggle
            checked={draft.allow_insecure}
            onChange={(on) => set({ allow_insecure: on })}
            aria-label="Allow insecure TLS"
          />
        </div>
      </div>

      <footer className="flex items-center justify-between gap-3 border-t border-hairline px-4 py-3">
        <span className="flex min-w-0 items-center gap-2">
          <StatusDot tone={isRunning ? "ok" : "off"} size={6} />
          <span className="truncate text-note text-t2">
            {isRunning
              ? "Saving restarts the running tunnel."
              : "Changes apply the next time this tunnel starts."}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-3">
          <Button
            variant="secondary"
            disabled={!dirty || saving}
            onClick={() => {
              setDraft(source);
              setTouched(new Set());
              setAttempted(false);
            }}
          >
            Discard
          </Button>
          <Button
            variant="primary"
            disabled={!dirty || saving}
            onClick={() => {
              setAttempted(true);
              if (!valid) return;
              onSave({
                ...draft,
                name: draft.name.trim(),
                credential: draft.credential.trim(),
                remote_host: draft.remote_host.trim(),
                sni: draft.sni.trim(),
                fingerprint: draft.fingerprint.trim(),
              });
            }}
          >
            <Icon name="check" size={14} />
            {saving ? "Saving" : "Save"}
          </Button>
        </span>
      </footer>
    </div>
  );
}
