import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { AboutTab } from "@/components/about/AboutTab";
import { PreferencesSheet } from "@/components/prefs/PreferencesSheet";
import { Badge } from "@/components/ui/Badge";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ConfigTab } from "@/components/config/ConfigTab";
import { CoreSetupModal } from "@/components/core/CoreSetupModal";
import { SocketsTab } from "@/components/sockets/SocketsTab";
import { TelemetryTab } from "@/components/telemetry/TelemetryTab";
import { TitleBar } from "@/components/shell/TitleBar";
import { StatusFooter } from "@/components/shell/StatusFooter";
import { TabRegion, type Tab } from "@/components/shell/TabRegion";
import { loadPrefs, savePrefs, type Prefs } from "@/lib/prefs";
import {
  Profile,
  ProxyState,
  Store,
  activeProfile,
  type TunnelProfile,
  type TunnelState,
  type TunnelStore,
  TUNNEL_STATE_TEXT,
} from "@/types";
import { canStartTunnel, nextTunnelState } from "@/lib/tunnelMachine";
import { modeTransition, type Transition } from "@/lib/modeTransition";
import { applyUpdate, findUpdate, type Progress } from "@/lib/updater";
import { listenAddress, middleTruncate, type CoreStatus } from "@/lib/readouts";
import { UpdateMeter } from "@/components/UpdateMeter";
import type { Update } from "@tauri-apps/plugin-updater";

export default function App() {
  const [store, setStore] = useState<Store | null>(null);
  const [state, setState] = useState<ProxyState>("stopped");
  /** Which profile the engine is actually running. Not the same as active. */
  const [runningId, setRunningId] = useState<string | null>(null);
  /** When the engine came up, for the uptime readout. */
  const [since, setSince] = useState<number | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);
  const [exitDialogOpen, setExitDialogOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  /** A failure to show, with what it was about. The title was guessed from
   *  a string prefix, so a failed clipboard write told the user the SNI link
   *  could not start. */
  const [errorDialog, setErrorDialog] = useState<{ title: string; message: string } | null>(null);
  const fail = (title: string) => (e: unknown) =>
    setErrorDialog({ title, message: String(e) });
  const [update, setUpdate] = useState<Update | null>(null);
  const [updating, setUpdating] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);

  // The optional second stage. `tunnels === null` only until the first load
  // resolves; an empty store is the normal, shipped state.
  const [tunnels, setTunnels] = useState<TunnelStore | null>(null);
  const [tunnelState, setTunnelState] = useState<TunnelState>("offline");
  const [tunnelSince, setTunnelSince] = useState<number | null>(null);
  const [core, setCore] = useState<CoreStatus | null>(null);
  const coreInstalled = core?.installed ?? false;
  const [tab, setTab] = useState<Tab>("telemetry");
  const [prefs, setPrefs] = useState<Prefs>(() => loadPrefs());
  const [confirmStopLink, setConfirmStopLink] = useState(false);
  const [coreSetupOpen, setCoreSetupOpen] = useState(false);
  const [savingRouting, setSavingRouting] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);

  // The tray listeners are registered once on mount, so the handlers they
  // close over must read live state through refs, not stale captures.
  const storeRef = useRef<Store | null>(null);
  const runningRef = useRef<string | null>(null);
  storeRef.current = store;
  runningRef.current = runningId;

  useEffect(() => {
    void invoke<Store>("list_profiles").then(setStore);
    void invoke<TunnelStore>("list_tunnels").then(setTunnels);
    void invoke<CoreStatus>("core_status").then(setCore);
  }, []);

  // The tray badge lives in the privileged half as well as in browser
  // storage, so a stored choice has to be pushed back on launch - otherwise
  // it only holds for the session in which it was made. `verbose` is not
  // pushed here: ActivitySection gates it on the log section being open, so
  // that per-packet logging never runs with nothing reading it.
  useEffect(() => {
    void invoke("set_tray_colorize", { on: prefs.colorizeTray });
    // Mount only: every later change goes through Preferences, which calls
    // these itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // One check per launch, and only if the user has left it on. Silent when
  // we are current or the check fails: this application's users are
  // plausibly behind something that blocks github.com, and an update is a
  // convenience that must never surface as a failure.
  useEffect(() => {
    if (!prefs.silentUpdateChecks) return;
    void findUpdate().then(setUpdate);
    // Deliberately on mount only. Turning the preference on mid-session
    // should not fire a check the user did not ask for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const unlistenState = listen<ProxyState>("state-changed", (e) => {
      setState(e.payload);
      // The clock starts when the engine reports it is up, not when we asked
      // it to start: elevation prompts can sit for a minute.
      if (e.payload === "running") setSince((prev) => prev ?? Date.now());
      if (e.payload === "stopped" || e.payload === "error") {
        setRunningId(null);
        setSince(null);
      }
    });
    const unlistenStart = listen("frontend-start-requested", () => void start());
    const unlistenStop = listen("frontend-stop-requested", () => void stop());
    const unlistenQuit = listen("frontend-quit-requested", () => setExitDialogOpen(true));
    return () => {
      unlistenState.then((f) => f());
      unlistenStart.then((f) => f());
      unlistenStop.then((f) => f());
      unlistenQuit.then((f) => f());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const un = listen<{ state: TunnelState; detail: string | null }>(
      "tunnel-state-changed",
      (e) => {
        setTunnelState(e.payload.state);
        // Started when the engine says it is up, not when we asked — the
        // same call App already makes for the link's clock.
        setTunnelSince(e.payload.state === "active" ? Date.now() : null);
        if (e.payload.state === "fault" && e.payload.detail) {
          setErrorDialog({ title: "The tunnel stopped", message: e.payload.detail });
        }
      },
    );
    return () => {
      void un.then((f) => f());
    };
  }, []);

  // The coupling: the tunnel cannot outlive the link it dials. Encoded once,
  // in tunnelMachine, so the rule is tested rather than scattered.
  useEffect(() => {
    setTunnelState((current) => nextTunnelState(current, state));
  }, [state]);

  async function startTunnel() {
    const id = tunnels?.active_id;
    if (!id) return;
    try {
      await invoke("start_tunnel", { id });
    } catch (e) {
      fail("The tunnel could not start")(e);
    }
  }

  async function stopTunnel() {
    await invoke("stop_tunnel");
    setTunnelState("offline");
    setTunnelSince(null);
  }

  /**
   * Carries out what a routing-mode change requires. `modeTransition` owns
   * the decision; this owns the order, and the order matters: the OS proxy
   * is undone *before* the core changes shape under it, so there is never a
   * moment where the machine points at a port that has stopped listening.
   *
   * `applyProxy` is an `else` on purpose - a restart's own `start_tunnel`
   * applies the proxy itself when the new mode asks for it.
   */
  async function reconcileMode(plan: Transition, activeId: string | null) {
    if (plan.clearProxy) await invoke("clear_system_proxy");
    if (plan.restartTunnel && activeId) {
      await invoke("stop_tunnel");
      await invoke("start_tunnel", { id: activeId });
    } else if (plan.applyProxy) {
      await invoke("apply_system_proxy");
    }
  }

  /** Stops both in the order the engine does: the tunnel dials the link. */
  async function stopBoth() {
    await stopTunnel();
    await stop();
  }

  async function saveTunnel(t: TunnelProfile) {
    const withId = t.id ? t : { ...t, id: `t${Date.now()}` };
    let next = await invoke<TunnelStore>("save_tunnel", { profile: withId });
    // A brand new tunnel becomes the active one: creating it is a statement
    // of intent to use it. The same call `save` makes for a profile.
    if (!t.id) next = await invoke<TunnelStore>("set_active_tunnel", { id: withId.id });
    setTunnels(next);
  }

  async function start(id?: string) {
    const current = storeRef.current;
    const target = id ?? current?.active_id;
    if (!target) return;
    try {
      await invoke("start_proxy", { id: target });
      setRunningId(target);
    } catch (e) {
      fail("The SNI link could not start")(e);
    }
  }

  async function stop() {
    await invoke("stop_proxy");
    setRunningId(null);
    setSince(null);
  }

  /**
   * Selecting a profile makes it active. If the engine is running it also
   * switches over: the engine is already authenticated, so this costs no
   * password prompt and takes well under a second.
   */
  async function select(id: string) {
    setStore(await invoke<Store>("set_active_profile", { id }));
    if (runningRef.current !== null && runningRef.current !== id) {
      // A restart into a different profile is a new session, so the clock
      // restarts with it.
      setSince(null);
      await start(id);
    }
  }

  async function save(profile: Profile) {
    const withId = profile.id ? profile : { ...profile, id: `p${Date.now()}` };
    const next = await invoke<Store>("save_profile", { profile: withId });
    setStore(next);
    // A brand new profile becomes the active one: creating it is a statement
    // of intent to use it.
    if (!profile.id) setStore(await invoke<Store>("set_active_profile", { id: withId.id }));
  }

  async function remove(id: string) {
    if (id === runningRef.current) {
      setConfirmDelete(id);
      return;
    }
    try {
      setStore(await invoke<Store>("delete_profile", { id }));
    } catch (e) {
      fail("The profile could not be deleted")(e);
    }
  }

  async function confirmRemove() {
    const id = confirmDelete;
    setConfirmDelete(null);
    if (!id) return;
    await stop();
    try {
      setStore(await invoke<Store>("delete_profile", { id }));
    } catch (e) {
      fail("The profile could not be deleted")(e);
    }
  }

  /** Every preference change goes through here, so nothing can be changed
   *  in the interface without also being written down. */
  function updatePrefs(patch: Partial<Prefs>) {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    savePrefs(next);
  }

  /**
   * The close glyph. With "Close Window Minimizes to Menu Bar" on it hides
   * to the tray, which is what the tray exists for; with it off it asks,
   * because closing would otherwise stop an elevated proxy the user may not
   * realise is running.
   */
  function closeWindow() {
    if (prefs.closeToTray) {
      void getCurrentWindow().hide();
    } else {
      setExitDialogOpen(true);
    }
  }

  async function confirmExit() {
    await invoke("stop_proxy");
    await invoke("shutdown_engine");
    await getCurrentWindow().destroy();
  }

  const profile = store ? activeProfile(store) : undefined;

  // Two phases, one flow. `Finished` reports total === received, so the
  // download is over exactly when they meet; before the first event there is
  // no progress object yet and we are certainly still downloading.
  const downloading =
    !progress || progress.total === null || progress.received < progress.total;

  const blockedReason = canStartTunnel(state, coreInstalled, tunnels?.active_id != null);
  const tunnelRunning = tunnelState !== "offline";

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-surface">
      <TitleBar
        tab={tab}
        onTabChange={setTab}
        state={state}
        core={core}
        onClose={closeWindow}
        onPreferences={() => setPrefsOpen(true)}
      />

      <TabRegion tab={tab}>
        {tab === "telemetry" && (
          <TelemetryTab
            store={store}
            tunnels={tunnels}
            state={state}
            since={since}
            runningId={runningId}
            tunnelState={tunnelState}
            tunnelSince={tunnelSince}
            coreInstalled={coreInstalled}
            blockedReason={blockedReason}
            activityOpen={activityOpen}
            onActivityOpenChange={setActivityOpen}
            verbose={prefs.verbose}
            onVerboseChange={(on) => updatePrefs({ verbose: on })}
            onLinkToggle={(on) => {
              if (on) return void start();
              // Stopping the link takes the tunnel with it, so once the
              // tunnel is up this is a decision rather than a reflex.
              if (tunnelRunning) setConfirmStopLink(true);
              else void stop();
            }}
            onTunnelToggle={(on) => (on ? void startTunnel() : void stopTunnel())}
            onSelectProfile={(id) => void select(id)}
            onSelectTunnel={(id) =>
              void invoke<TunnelStore>("set_active_tunnel", { id }).then(setTunnels)
            }
            onModeChange={(mode) => {
              if (!tunnels) return;
              const plan = modeTransition(tunnels.mode, mode, tunnelState === "active");
              void invoke<TunnelStore>("save_routing", {
                mode,
                proxy_host: tunnels.proxy_host,
                proxy_port: tunnels.proxy_port,
                routing: tunnels.routing,
              })
                .then(async (next) => {
                  setTunnels(next);
                  await reconcileMode(plan, next.active_id);
                })
                .catch(fail("The routing rules could not be saved"));
            }}
            onSetupCore={() => setCoreSetupOpen(true)}
          />
        )}

        {tab === "sockets" && (
          <SocketsTab
            store={tunnels}
            saving={savingRouting}
            onSave={(patch) => {
              setSavingRouting(true);
              const plan = modeTransition(
                tunnels?.mode ?? "manual",
                patch.mode,
                tunnelState === "active",
              );
              void invoke<TunnelStore>("save_routing", patch)
                .then(async (next) => {
                  setTunnels(next);
                  await reconcileMode(plan, next.active_id);
                })
                .catch(fail("The routing rules could not be saved"))
                .finally(() => setSavingRouting(false));
            }}
          />
        )}

        {tab === "config" && (
          <ConfigTab
            store={store}
            tunnels={tunnels}
            runningId={runningId}
            tunnelRunningId={tunnelRunning ? (tunnels?.active_id ?? null) : null}
            saving={savingProfile}
            onSaveProfile={(p) => {
              setSavingProfile(true);
              void save(p).finally(() => setSavingProfile(false));
            }}
            onDeleteProfile={(id) => void remove(id)}
            onSelectProfile={(id) => void select(id)}
            onSaveTunnel={(t) => {
              setSavingProfile(true);
              void saveTunnel(t).finally(() => setSavingProfile(false));
            }}
            onDeleteTunnel={(id) =>
              void invoke<TunnelStore>("delete_tunnel", { id })
                .then(setTunnels)
                .catch(fail("The tunnel could not be deleted"))
            }
            onSelectTunnel={(id) =>
              void invoke<TunnelStore>("set_active_tunnel", { id }).then(setTunnels)
            }
            onCopyTunnelLink={(id) =>
              void invoke<string>("export_tunnel_uri", { id })
                .then((uri) => navigator.clipboard.writeText(uri))
                .catch(fail("The share link could not be copied"))
            }
          />
        )}

        {tab === "about" && (
          <AboutTab
            update={update}
            onUpdateFound={setUpdate}
            updating={updating}
            progress={progress}
            silentChecks={prefs.silentUpdateChecks}
            onSilentChecksChange={(on) => updatePrefs({ silentUpdateChecks: on })}
            onInstall={() => {
              if (!update) return;
              setUpdating(true);
              setProgress(null);
              void applyUpdate(update, setProgress).catch((err) => {
                setUpdating(false);
                setProgress(null);
                setUpdate(null);
                setErrorDialog({ title: "The update could not be applied", message: String(err) });
              });
            }}
          />
        )}
      </TabRegion>

      <StatusFooter store={store} closeToTray={prefs.closeToTray} />

      <PreferencesSheet
        open={prefsOpen}
        onOpenChange={setPrefsOpen}
        prefs={prefs}
        onPrefsChange={updatePrefs}
        core={core}
        onCoreChanged={() => void invoke<CoreStatus>("core_status").then(setCore)}
        tunnels={tunnels}
        savingNetwork={savingRouting}
        onSaveNetwork={(patch) => {
          if (!tunnels) return;
          setSavingRouting(true);
          void invoke<TunnelStore>("save_routing", {
            mode: tunnels.mode,
            proxy_host: patch.proxy_host,
            proxy_port: patch.proxy_port,
            routing: tunnels.routing,
          })
            .then(setTunnels)
            .catch(fail("The network settings could not be saved"))
            .finally(() => setSavingRouting(false));
        }}
      />

      <CoreSetupModal
        open={coreSetupOpen}
        onOpenChange={setCoreSetupOpen}
        onInstalled={() => void invoke<CoreStatus>("core_status").then(setCore)}
      />

      {/* One inset fact table, and every row in it is something the
          application already knows. The mockup's "2 Active Links" counter is
          not: there is no connection count anywhere in the engine. */}
      <ConfirmDialog
        open={exitDialogOpen}
        onOpenChange={setExitDialogOpen}
        tone="danger"
        icon="power_settings_new"
        title="Quit Snifake?"
        badge={
          tunnelRunning ? (
            <Badge tone="warn">tunnel active</Badge>
          ) : state === "running" ? (
            <Badge tone="ok">link active</Badge>
          ) : undefined
        }
        description={
          state === "running" || tunnelRunning
            ? "Quitting stops both stages and closes the elevated engine. Closing the window instead leaves everything running in the tray."
            : "Nothing is running. Quitting closes the window and the tray icon."
        }
        details={
          <dl className="flex flex-col gap-[6px] text-note">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-t3">SNI link</dt>
              <dd className="mono min-w-0 truncate text-t1">
                {profile ? `${middleTruncate(profile.name, 22)} · ${listenAddress(profile)}` : "none"}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-t3">Tunnel</dt>
              <dd className="mono min-w-0 truncate text-t1">
                {TUNNEL_STATE_TEXT[tunnelState]}
                {tunnels ? ` · ${tunnels.mode.replace("_", " ")}` : ""}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3 border-t border-hairline pt-[6px]">
              <dt className="text-t3">Traffic impact</dt>
              <dd className="text-bad">
                {state === "running" || tunnelRunning
                  ? "Live sockets are terminated"
                  : "Nothing is carrying traffic"}
              </dd>
            </div>
          </dl>
        }
        cancelLabel="Cancel"
        confirmLabel="Quit Snifake"
        onConfirm={() => void confirmExit()}
      />

      <ConfirmDialog
        open={confirmStopLink}
        onOpenChange={() => setConfirmStopLink(false)}
        tone="neutral"
        icon="link_off"
        title="Stop the SNI link?"
        badge={<Badge tone="warn">tunnel runs through it</Badge>}
        description="The tunnel dials this link's listener, so stopping stage one takes stage two down with it. Both will stop."
        cancelLabel="Keep running"
        confirmLabel="Stop both"
        onConfirm={() => {
          setConfirmStopLink(false);
          void stopBoth();
        }}
      />

      <ConfirmDialog
        open={confirmDelete !== null}
        onOpenChange={() => setConfirmDelete(null)}
        tone="danger"
        icon="delete"
        title="Delete the profile that is running?"
        description="The engine is carrying traffic on this profile. It will be stopped before the profile is removed."
        details={
          <p className="mono text-note text-t1">
            {(() => {
              const target = store?.profiles.find((p) => p.id === confirmDelete);
              return target ? `${middleTruncate(target.name, 26)} · ${listenAddress(target)}` : "";
            })()}
          </p>
        }
        cancelLabel="Cancel"
        confirmLabel="Stop and delete"
        onConfirm={() => void confirmRemove()}
      />

      {/* The update offer. One badge, reading `Signed`, and it is the only
          claim made about the file: the plugin verifies a minisign signature
          before it applies anything. The mockup claimed `Verified SHA-256`
          and `Notarized` as well - the first is not what is checked and the
          second is an Apple process that is not ours to claim. */}
      <ConfirmDialog
        open={update !== null}
        onOpenChange={() => !updating && setUpdate(null)}
        tone="neutral"
        icon="system_update_alt"
        title={`Snifake v${update?.version ?? ""} is available`}
        badge={<Badge tone="accent">v{update?.version ?? ""}</Badge>}
        description={
          !updating
            ? `You are on v${update?.currentVersion ?? ""}. It will be downloaded, verified and installed, and Snifake restarts.`
            : downloading
              ? "Downloading. Snifake will restart once it is installed."
              : "Installing. Snifake will restart when it finishes."
        }
        details={
          <div className="flex flex-col gap-2">
            {update?.body ? (
              <>
                <p className="mono text-micro tracking-[0.04em] text-t3 uppercase">
                  What is new in v{update.version}
                </p>
                <p className="mono max-h-[96px] overflow-auto text-note leading-[16.5px] text-t2">
                  {update.body}
                </p>
              </>
            ) : (
              <p className="text-note text-t2">
                This release ships no notes. The source repository has the full history.
              </p>
            )}
            {updating ? (
              <UpdateMeter progress={progress} />
            ) : (
              <div className="flex items-center justify-between gap-3 border-t border-hairline pt-2">
                <span className="mono text-note text-t3">
                  {update?.date ? `released ${update.date.slice(0, 10)}` : "release date unknown"}
                </span>
                <Badge tone="ok">signed</Badge>
              </div>
            )}
          </div>
        }
        busy={updating}
        cancelLabel="Later"
        confirmLabel={!updating ? "Update now" : downloading ? "Downloading" : "Installing"}
        onConfirm={() => {
          if (!update || updating) return;
          setUpdating(true);
          setProgress(null);
          void applyUpdate(update, setProgress).catch((err) => {
            setUpdating(false);
            setProgress(null);
            setUpdate(null);
            setErrorDialog({ title: "The update could not be applied", message: String(err) });
          });
        }}
      />

      {/* A dialog with one answer. `ConfirmDialog` gives it the same frame
          as the three that ask a question, and `Esc` dismisses it, which is
          what a message you have finished reading deserves. */}
      <ConfirmDialog
        open={errorDialog !== null}
        onOpenChange={() => setErrorDialog(null)}
        tone="danger"
        icon="error"
        title={errorDialog?.title ?? ""}
        description="This is what the engine reported."
        details={
          <p className="mono pick text-note leading-[16.5px] break-all text-t1">
            {errorDialog?.message}
          </p>
        }
        cancelLabel={null}
        confirmLabel="Close"
        onConfirm={() => setErrorDialog(null)}
      />

    </div>
  );
}
