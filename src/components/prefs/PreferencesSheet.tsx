import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { Button } from "@/components/ui/Button";
import { ModalSheet } from "@/components/ui/ModalSheet";
import { Segmented } from "@/components/ui/Segmented";
import { StatusDot } from "@/components/ui/StatusDot";
import { DEFAULT_PREFS, type Prefs } from "@/lib/prefs";
import type { CoreStatus } from "@/lib/readouts";
import type { TunnelStore } from "@/types";
import { CoreTab } from "./CoreTab";
import { GeneralTab } from "./GeneralTab";
import { NetworkTab } from "./NetworkTab";

type PrefTab = "general" | "network" | "core";

/**
 * Three tabs over one sheet. Every change takes effect as it is made -
 * there is no Apply, and the footer says so - because every one of these is
 * a single value with an immediate effect, and a form that batches them
 * would invent a "saved" state the application does not otherwise have.
 */
export function PreferencesSheet({
  open,
  onOpenChange,
  prefs,
  onPrefsChange,
  core,
  onCoreChanged,
  tunnels,
  onSaveNetwork,
  savingNetwork,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefs: Prefs;
  onPrefsChange: (patch: Partial<Prefs>) => void;
  core: CoreStatus | null;
  onCoreChanged: () => void;
  tunnels: TunnelStore | null;
  onSaveNetwork: (patch: { proxy_host: string; proxy_port: number }) => void;
  savingNetwork: boolean;
}) {
  const [tab, setTab] = useState<PrefTab>("general");
  const [version, setVersion] = useState("");

  useEffect(() => {
    void getVersion().then(setVersion);
  }, []);

  /**
   * Restores the five frontend-owned preferences and mirrors the two that
   * also live in Rust. It deliberately leaves `proxy_host` and `proxy_port`
   * alone: those are configuration the engine uses, not preference, and
   * resetting someone's listening port from a button labelled "restore
   * defaults" would be a surprise with consequences.
   */
  function restoreDefaults() {
    onPrefsChange({ ...DEFAULT_PREFS });
    void invoke("set_tray_colorize", { on: DEFAULT_PREFS.colorizeTray });
    void invoke(DEFAULT_PREFS.launchAtLogin ? "plugin:autostart|enable" : "plugin:autostart|disable").catch(
      () => {
        // The platform may refuse; the rest of the reset still stands.
      },
    );
  }

  return (
    <ModalSheet
      open={open}
      onOpenChange={onOpenChange}
      icon="settings"
      title="Preferences"
      subtitle={version ? `v${version}` : undefined}
      width={680}
      tabs={
        <Segmented
          size="sm"
          label="Preferences section"
          value={tab}
          onChange={setTab}
          options={[
            { value: "general", label: "General" },
            { value: "network", label: "Network" },
            { value: "core", label: "Core" },
          ]}
        />
      }
      footer={
        <>
          <span className="flex min-w-0 items-center gap-2">
            <StatusDot tone="ok" size={8} />
            <span className="truncate text-note text-t2">Changes take effect immediately</span>
          </span>
          <span className="flex shrink-0 items-center gap-3">
            <Button variant="secondary" onClick={restoreDefaults}>
              Restore defaults
            </Button>
            <Button variant="primary" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          </span>
        </>
      }
    >
      {tab === "general" ? (
        <GeneralTab prefs={prefs} onChange={onPrefsChange} />
      ) : tab === "network" ? (
        <NetworkTab store={tunnels} onSave={onSaveNetwork} saving={savingNetwork} />
      ) : (
        <CoreTab
          core={core}
          onCoreChanged={onCoreChanged}
          verbose={prefs.verbose}
          onVerboseChange={(on) => onPrefsChange({ verbose: on })}
        />
      )}
    </ModalSheet>
  );
}
