import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Segmented } from "@/components/ui/Segmented";
import { listenAddress, tunnelSignature } from "@/lib/readouts";
import type { Profile, Store, TunnelProfile, TunnelStore } from "@/types";
import { ProfileList, type ListItem } from "./ProfileList";
import { SniEditor } from "./SniEditor";
import { TunnelEditorPane } from "./TunnelEditorPane";

export type ConfigKind = "sni" | "tunnel";

/**
 * Master and detail, side by side, so state and configuration are visible at
 * the same time. The old interface stacked the editor in a drawer over the
 * operating panel, which is why nothing could be checked while it was open.
 */
export function ConfigTab({
  store,
  tunnels,
  runningId,
  tunnelRunningId,
  saving,
  onSaveProfile,
  onDeleteProfile,
  onSelectProfile,
  onImport,
  onSaveTunnel,
  onDeleteTunnel,
  onSelectTunnel,
  onCopyTunnelLink,
}: {
  store: Store | null;
  tunnels: TunnelStore | null;
  runningId: string | null;
  tunnelRunningId: string | null;
  saving: boolean;
  onSaveProfile: (p: Profile) => void;
  onDeleteProfile: (id: string) => void;
  onSelectProfile: (id: string) => void;
  onImport: () => void;
  onSaveTunnel: (t: TunnelProfile) => void;
  onDeleteTunnel: (id: string) => void;
  onSelectTunnel: (id: string) => void;
  onCopyTunnelLink: (id: string) => void;
}) {
  const [kind, setKind] = useState<ConfigKind>("sni");
  const [selectedSni, setSelectedSni] = useState<string | null>(null);
  const [selectedTunnel, setSelectedTunnel] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [creatingTunnel, setCreatingTunnel] = useState(false);

  // Default the selection to whatever is active, and follow the store when
  // the selected profile is deleted out from under the pane.
  useEffect(() => {
    if (!store) return;
    setSelectedSni((current) =>
      current && store.profiles.some((p) => p.id === current) ? current : store.active_id,
    );
  }, [store]);

  useEffect(() => {
    if (!tunnels) return;
    setSelectedTunnel((current) =>
      current && tunnels.tunnels.some((t) => t.id === current) ? current : tunnels.active_id,
    );
  }, [tunnels]);

  const sniItems: ListItem[] = (store?.profiles ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    subject: p.FAKE_SNI,
    foot: `inbound ${listenAddress(p)}`,
  }));

  const tunnelItems: ListItem[] = (tunnels?.tunnels ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    subject: `${t.remote_host}${t.path}`,
    foot: tunnelSignature(t),
  }));

  const selectedProfile = creating
    ? null
    : ((store?.profiles ?? []).find((p) => p.id === selectedSni) ?? null);
  const selectedTunnelProfile = creatingTunnel
    ? null
    : ((tunnels?.tunnels ?? []).find((t) => t.id === selectedTunnel) ?? null);
  const activeSni = (store?.profiles ?? []).find((p) => p.id === store?.active_id);

  return (
    <div className="flex h-full flex-col gap-4 px-5 py-5">
      <header className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-baseline gap-3">
          <h1 className="text-title font-semibold tracking-[-0.4px] text-t1">Configurations</h1>
          <span className="mono truncate text-note text-t3">1 active per category</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Segmented
            label="Configuration kind"
            value={kind}
            onChange={(k) => {
              setKind(k);
              setCreating(false);
              setCreatingTunnel(false);
            }}
            size="sm"
            options={[
              { value: "sni", label: "SNI links", badge: sniItems.length },
              { value: "tunnel", label: "Tunnels", badge: tunnelItems.length },
            ]}
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              if (kind === "sni") {
                setCreating(true);
                setSelectedSni(null);
              } else {
                setCreatingTunnel(true);
                setSelectedTunnel(null);
              }
            }}
          >
            <Icon name="add" size={13} />
            New
          </Button>
          {/* Import only ever produces a tunnel: there is no share-link
              format for an SNI profile (spec 4.2). Disabled rather than
              hidden, so its absence on this side is a stated fact. */}
          <Button
            variant="secondary"
            size="sm"
            onClick={onImport}
            disabled={kind !== "tunnel"}
            title={
              kind === "tunnel"
                ? "Import a share link or Xray JSON"
                : "Import produces a tunnel. There is no share-link format for an SNI link."
            }
          >
            <Icon name="download" size={13} />
            Import
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 items-stretch gap-4">
        {kind === "sni" ? (
          <>
            <ProfileList
              kind="sni"
              items={sniItems}
              activeId={store?.active_id ?? null}
              runningId={runningId}
              selectedId={creating ? null : selectedSni}
              onSelect={(id) => {
                setCreating(false);
                setSelectedSni(id);
                onSelectProfile(id);
              }}
            />
            <SniEditor
              profile={selectedProfile}
              isActive={selectedProfile?.id === store?.active_id}
              isRunning={selectedProfile != null && selectedProfile.id === runningId}
              saving={saving}
              onSave={(p) => {
                setCreating(false);
                onSaveProfile(p);
              }}
              onDelete={onDeleteProfile}
            />
          </>
        ) : (
          <>
            <ProfileList
              kind="tunnel"
              items={tunnelItems}
              activeId={tunnels?.active_id ?? null}
              runningId={tunnelRunningId}
              selectedId={creatingTunnel ? null : selectedTunnel}
              onSelect={(id) => {
                setCreatingTunnel(false);
                setSelectedTunnel(id);
                onSelectTunnel(id);
              }}
            />
            <TunnelEditorPane
              tunnel={selectedTunnelProfile}
              sniProfile={activeSni}
              isActive={selectedTunnelProfile?.id === tunnels?.active_id}
              isRunning={
                selectedTunnelProfile != null && selectedTunnelProfile.id === tunnelRunningId
              }
              saving={saving}
              onSave={(t) => {
                setCreatingTunnel(false);
                onSaveTunnel(t);
              }}
              onDelete={onDeleteTunnel}
              onCopyLink={onCopyTunnelLink}
            />
          </>
        )}
      </div>
    </div>
  );
}
