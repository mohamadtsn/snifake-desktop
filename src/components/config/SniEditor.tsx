import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { StatusDot } from "@/components/ui/StatusDot";
import { TextField } from "@/components/ui/TextField";
import type { Profile } from "@/types";

function isValidIp(value: string): boolean {
  const parts = value.split(".");
  if (parts.length !== 4) return false;
  return parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) >= 0 && Number(p) <= 255);
}

function isValidPort(value: string): boolean {
  return /^\d{1,5}$/.test(value) && Number(value) >= 1 && Number(value) <= 65535;
}

const blank = (): Profile => ({
  id: "",
  name: "",
  LISTEN_HOST: "127.0.0.1",
  LISTEN_PORT: 10808,
  CONNECT_IP: "",
  CONNECT_PORT: 443,
  FAKE_SNI: "",
});

/**
 * The detail pane for one SNI link.
 *
 * Validation is inline and per keystroke, and it is a convenience only:
 * `engine/src/validate.rs` runs as root and is the actual guarantee. What
 * this side buys is that a bad port is caught before an elevation prompt,
 * not after.
 */
export function SniEditor({
  profile,
  isActive,
  isRunning,
  onSave,
  onDelete,
  saving,
}: {
  /** `null` while creating a new one. */
  profile: Profile | null;
  isActive: boolean;
  isRunning: boolean;
  onSave: (p: Profile) => void;
  onDelete: (id: string) => void;
  saving: boolean;
}) {
  const source = profile ?? blank();
  const [draft, setDraft] = useState(source);
  /**
   * Which fields the user has actually edited.
   *
   * A form must not accuse someone of a mistake they have not had the
   * chance to make. It also stops the editor flashing three red borders on
   * the frame before the store resolves, when the draft is still the blank
   * one and its name, address and SNI are all legitimately empty.
   */
  const [touched, setTouched] = useState<Set<keyof Profile>>(new Set());
  const [attempted, setAttempted] = useState(false);

  // Reload whenever a different profile is selected, or the stored one
  // changes under us after a save.
  useEffect(() => {
    setDraft(profile ?? blank());
    setTouched(new Set());
    setAttempted(false);
  }, [profile]);

  const errors = {
    name: draft.name.trim() ? null : "Give it a name you will recognise.",
    host: isValidIp(draft.LISTEN_HOST.trim()) ? null : "An IPv4 address, usually 127.0.0.1.",
    listenPort: isValidPort(String(draft.LISTEN_PORT)) ? null : "A port between 1 and 65535.",
    connectIp: isValidIp(draft.CONNECT_IP.trim()) ? null : "The upstream server's IPv4 address.",
    connectPort: isValidPort(String(draft.CONNECT_PORT)) ? null : "A port between 1 and 65535.",
    sni: draft.FAKE_SNI.trim() ? null : "The hostname the fake ClientHello will carry.",
  };
  const valid = Object.values(errors).every((e) => e === null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(source);

  /** Shown only once the user has been in the field, or has tried to save. */
  const shown = (key: keyof Profile, message: string | null) =>
    attempted || touched.has(key) ? message : null;

  const set = (patch: Partial<Profile>) => {
    setDraft({ ...draft, ...patch });
    setTouched(new Set([...touched, ...(Object.keys(patch) as (keyof Profile)[])]));
  };
  const num = (v: string) => (v.trim() === "" ? 0 : Number(v.replace(/\D/g, "")));

  return (
    <div className="flex min-w-0 flex-1 flex-col rounded-lg border border-hairline bg-card shadow-specular">
      <header className="flex items-center gap-3 border-b border-hairline px-4 py-3">
        <span className="flex size-[32px] shrink-0 items-center justify-center rounded-md border border-accent-line bg-accent-soft text-accent shadow-sunken">
          <Icon name="tune" size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-row font-semibold text-t1">
              {draft.name.trim() || (profile ? "Untitled link" : "New SNI link")}
            </h2>
            {isActive ? <Badge tone="ok">active</Badge> : null}
          </div>
          <p className="mono mt-[1px] truncate text-note text-t3">
            SNI inbound link{profile ? ` · id ${profile.id}` : " · not saved yet"}
          </p>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-1 px-4 pt-3 pb-1">
        <TextField
          label="Profile identifier name"
          value={draft.name}
          onChange={(v) => set({ name: v })}
          error={shown("name", errors.name)}
          mono={false}
        />

        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <TextField
              label="Listen host (loopback)"
              hint="IPv4"
              value={draft.LISTEN_HOST}
              onChange={(v) => set({ LISTEN_HOST: v })}
              error={shown("LISTEN_HOST", errors.host)}
              placeholder="127.0.0.1"
            />
          </div>
          <div className="w-[150px] shrink-0">
            <TextField
              label="Listen port"
              value={String(draft.LISTEN_PORT)}
              onChange={(v) => set({ LISTEN_PORT: num(v) })}
              error={shown("LISTEN_PORT", errors.listenPort)}
              placeholder="10808"
            />
          </div>
        </div>

        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <TextField
              label="Target connect IP (IPv4)"
              value={draft.CONNECT_IP}
              onChange={(v) => set({ CONNECT_IP: v })}
              error={shown("CONNECT_IP", errors.connectIp)}
              placeholder="185.199.108.153"
            />
          </div>
          <div className="w-[150px] shrink-0">
            <TextField
              label="Remote port"
              value={String(draft.CONNECT_PORT)}
              onChange={(v) => set({ CONNECT_PORT: num(v) })}
              error={shown("CONNECT_PORT", errors.connectPort)}
              placeholder="443"
            />
          </div>
        </div>

        <TextField
          label="Fake SNI domain mask"
          hint="TLS ClientHello"
          value={draft.FAKE_SNI}
          onChange={(v) => set({ FAKE_SNI: v })}
          error={shown("FAKE_SNI", errors.sni)}
          placeholder="assets.github.com"
          icon={<Icon name="lock" size={13} />}
        />

        {/* Where the mockup drew a "TLS Packet Fragmentation" switch. The
            engine does not fragment anything, so there is nothing to switch;
            what it does do is worth one sentence, and a sentence cannot be
            turned on by mistake. */}
        <div className="mt-2 flex items-start gap-3 rounded-md border border-hairline bg-inset px-3 py-[10px]">
          <Icon name="bolt" size={16} className="mt-[1px] shrink-0 text-t3" />
          <p className="text-note leading-[16.5px] text-t2">
            The engine does not fragment the handshake. It injects one out-of-window fake
            ClientHello carrying this name the instant the connection is established: inspection
            parses the fake, and the server never sees it because it arrives before the receive
            window.
          </p>
        </div>
      </div>

      {/* The action bar. `Delete` used to be a `ghost` button in the header:
          the lightest weight the design system has, for the one irreversible
          action on the pane. It is `secondary` here, tinted destructive, at
          the far left - away from `Save`, where a slip cannot reach it - and
          it is the same shape the Sockets tab uses for "actions on this
          pane". The sentence keeps the middle and yields width first, since
          it is the only thing here that can be re-read at leisure. */}
      <footer className="flex items-center justify-between gap-3 border-t border-hairline px-4 py-3">
        {profile ? (
          <Button
            variant="secondary"
            size="sm"
            className="shrink-0 border-bad-line text-bad hover:bg-bad-soft"
            onClick={() => onDelete(profile.id)}
          >
            <Icon name="delete" size={13} />
            Delete
          </Button>
        ) : (
          <span />
        )}
        <span className="flex min-w-0 items-center gap-2">
          <StatusDot tone={isRunning ? "ok" : "off"} size={6} />
          <span className="truncate text-note text-t2">
            {isRunning
              ? "Saving restarts the running engine into this profile."
              : "Changes apply the next time this profile starts."}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-3">
          <Button
            variant="secondary"
            onClick={() => {
              setDraft(source);
              setTouched(new Set());
              setAttempted(false);
            }}
            disabled={!dirty || saving}
          >
            Discard
          </Button>
          <Button
            variant="primary"
            disabled={!dirty || saving}
            onClick={() => {
              // Pressing Save with something wrong turns every message on at
              // once, which is the moment they become useful: the user has
              // said they are finished.
              setAttempted(true);
              if (!valid) return;
              onSave({
                ...draft,
                name: draft.name.trim(),
                LISTEN_HOST: draft.LISTEN_HOST.trim(),
                CONNECT_IP: draft.CONNECT_IP.trim(),
                FAKE_SNI: draft.FAKE_SNI.trim(),
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
