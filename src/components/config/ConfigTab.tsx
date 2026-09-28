import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Segmented } from "@/components/ui/Segmented";
import { listenAddress, tunnelSignature } from "@/lib/readouts";
import type { DraftOwner, DraftReport } from "@/lib/leaveGuard";
import type { Profile, Store, TunnelProfile, TunnelStore } from "@/types";
import { ProfileList, type ListItem } from "./ProfileList";
import { SniEditor } from "./SniEditor";
import { ImportSheet } from "./ImportSheet";
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
  onSaveTunnel,
  onDeleteTunnel,
  onSelectTunnel,
  onCopyTunnelLink,
  onDraftChange,
  guardLeave,
}: {
  store: Store | null;
  tunnels: TunnelStore | null;
  runningId: string | null;
  tunnelRunningId: string | null;
  saving: boolean;
  onSaveProfile: (p: Profile) => Promise<void>;
  onDeleteProfile: (id: string) => void;
  onSelectProfile: (id: string) => void;
  onSaveTunnel: (t: TunnelProfile) => Promise<void>;
  onDeleteTunnel: (id: string) => void;
  onSelectTunnel: (id: string) => void;
  onCopyTunnelLink: (id: string) => void;
  onDraftChange: (report: DraftReport | null, owner: DraftOwner) => void;
  /** Runs `proceed` now, or after the unsaved-changes question. Every
   *  control here that would replace the editor goes through it. */
  guardLeave: (proceed: () => void, staying?: boolean) => void;
}) {
  const [kind, setKind] = useState<ConfigKind>("sni");
  const [selectedSni, setSelectedSni] = useState<string | null>(null);
  const [selectedTunnel, setSelectedTunnel] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [creatingTunnel, setCreatingTunnel] = useState(false);
  const [importing, setImporting] = useState(false);

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
            onChange={(k) =>
              guardLeave(() => {
                setKind(k);
                setCreating(false);
                setCreatingTunnel(false);
              }, k === kind)
            }
            size="sm"
            options={[
              { value: "sni", label: "SNI links", badge: sniItems.length },
              { value: "tunnel", label: "Tunnels", badge: tunnelItems.length },
            ]}
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              guardLeave(() => {
                if (kind === "sni") {
                  setCreating(true);
                  setSelectedSni(null);
                } else {
                  setCreatingTunnel(true);
                  setSelectedTunnel(null);
                }
              })
            }
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
            onClick={() => guardLeave(() => setImporting(true))}
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
              // Selecting is for *reading and editing*. Activating restarts
              // the running engine into the chosen profile, so it is its own
              // deliberate act on the row, not a side effect of looking at
              // one. CLAUDE.md records the same call about the chip rail
              // this list replaced.
              onSelect={(id) =>
                guardLeave(() => {
                  setCreating(false);
                  setSelectedSni(id);
                }, !creating && id === selectedSni)
              }
              onActivate={onSelectProfile}
            />
            <SniEditor
              profile={selectedProfile}
              isActive={selectedProfile?.id === store?.active_id}
              isRunning={selectedProfile != null && selectedProfile.id === runningId}
              saving={saving}
              onSave={(p) => onSaveProfile(p).then(() => setCreating(false))}
              onDelete={onDeleteProfile}
              onDraftChange={onDraftChange}
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
              onSelect={(id) =>
                guardLeave(() => {
                  setCreatingTunnel(false);
                  setSelectedTunnel(id);
                }, !creatingTunnel && id === selectedTunnel)
              }
              onActivate={onSelectTunnel}
            />
            <TunnelEditorPane
              tunnel={selectedTunnelProfile}
              sniProfile={activeSni}
              isActive={selectedTunnelProfile?.id === tunnels?.active_id}
              isRunning={
                selectedTunnelProfile != null && selectedTunnelProfile.id === tunnelRunningId
              }
              saving={saving}
              onSave={(t) => onSaveTunnel(t).then(() => setCreatingTunnel(false))}
              onDelete={onDeleteTunnel}
              onCopyLink={onCopyTunnelLink}
              onDraftChange={onDraftChange}
            />
          </>
        )}
      </div>

      <ImportSheet
        open={importing}
        onOpenChange={setImporting}
        onImported={(t) => {
          setKind("tunnel");
          setCreatingTunnel(false);
          // The shell has already shown why a save failed.
          void onSaveTunnel(t).catch(() => {});
        }}
      />
    </div>
  );
}
