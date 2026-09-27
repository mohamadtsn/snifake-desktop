import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { TelemetryTab } from "@/components/telemetry/TelemetryTab";
import { TitleBar } from "@/components/shell/TitleBar";
import { StatusFooter } from "@/components/shell/StatusFooter";
import { TabRegion, type Tab } from "@/components/shell/TabRegion";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ModalSheet } from "@/components/ui/ModalSheet";
import { Icon } from "@/components/ui/Icon";
import { loadPrefs, type Prefs } from "@/lib/prefs";
import type { CoreStatus } from "@/lib/readouts";
import { ProfileSheet } from "@/components/ProfileSheet";
import { TunnelSheet } from "@/components/TunnelSheet";
import { CoreSetup } from "@/components/CoreSetup";
import { AboutDialog } from "@/components/AboutDialog";
import {
  Profile,
  ProxyState,
  Store,
  activeProfile,
  type Routing,
  type TunnelMode,
  type TunnelProfile,
  type TunnelState,
  type TunnelStore,
} from "@/types";
import { canStartTunnel, nextTunnelState } from "@/lib/tunnelMachine";
import { applyUpdate, findUpdate, type Progress } from "@/lib/updater";
import { UpdateMeter } from "@/components/UpdateMeter";
import type { Update } from "@tauri-apps/plugin-updater";

export default function App() {
  const [store, setStore] = useState<Store | null>(null);
  const [state, setState] = useState<ProxyState>("stopped");
  /** Which profile the engine is actually running. Not the same as active. */
  const [runningId, setRunningId] = useState<string | null>(null);
  /** When the engine came up, for the uptime readout. */
  const [since, setSince] = useState<number | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [exitDialogOpen, setExitDialogOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [errorDialog, setErrorDialog] = useState<string | null>(null);
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
  // Read once, on mount. `setPrefs` gets its consumer when the Preferences
  // sheet lands; until then a stored preference is still honoured, it just
  // cannot be changed from inside the window.
  const [prefs] = useState<Prefs>(() => loadPrefs());
  const [tunnelSheetOpen, setTunnelSheetOpen] = useState(false);
  const [confirmStopLink, setConfirmStopLink] = useState(false);
  const [coreSetupOpen, setCoreSetupOpen] = useState(false);

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

  // Two of the five preferences live in the privileged half as well as in
  // browser storage, so a stored choice has to be pushed back on launch -
  // otherwise it only holds for the session in which it was made.
  useEffect(() => {
    void invoke("set_tray_colorize", { on: prefs.colorizeTray });
    void invoke("set_verbose", { on: prefs.verbose });
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
          setErrorDialog(`Tunnel: ${e.payload.detail}`);
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
      setErrorDialog(String(e));
    }
  }

  async function stopTunnel() {
    await invoke("stop_tunnel");
    setTunnelState("offline");
    setTunnelSince(null);
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
      setErrorDialog(String(e));
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
      setErrorDialog(String(e));
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
      setErrorDialog(String(e));
    }
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

  const hasTunnels = (tunnels?.tunnels.length ?? 0) > 0;
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
        onPreferences={() => setAboutOpen(true)}
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
              void invoke<TunnelStore>("save_routing", {
                mode,
                proxy_host: tunnels.proxy_host,
                proxy_port: tunnels.proxy_port,
                routing: tunnels.routing,
              })
                .then(setTunnels)
                .catch((e) => setErrorDialog(String(e)));
            }}
            onSetupCore={() => setCoreSetupOpen(true)}
          />
        )}

        {tab === "sockets" && (
          <div className="flex flex-col gap-4 px-5 py-5">
            <Card>
              <div className="flex items-start gap-3 p-4">
                <Icon name="route" size={18} className="mt-[2px] text-accent" />
                <div className="flex-1">
                  <h2 className="text-row font-semibold text-t1">Interception and routing</h2>
                  <p className="mt-1 text-body text-t2">
                    How traffic reaches the tunnel, and which traffic is allowed to bypass
                    it. Editing the rule lists still opens the tunnel drawer.
                  </p>
                  <Button
                    className="mt-3"
                    variant="secondary"
                    onClick={() => setTunnelSheetOpen(true)}
                  >
                    Open routing rules
                  </Button>
                </div>
              </div>
            </Card>
          </div>
        )}

        {tab === "config" && (
          <div className="flex flex-col gap-4 px-5 py-5">
            <Card>
              <div className="flex items-start gap-3 p-4">
                <Icon name="lan" size={18} className="mt-[2px] text-accent" />
                <div className="flex-1">
                  <h2 className="text-row font-semibold text-t1">SNI links</h2>
                  <p className="mt-1 text-body text-t2">
                    {store && store.profiles.length > 0
                      ? `${store.profiles.length} configured.`
                      : "None configured yet. The first one is where everything starts."}
                  </p>
                  <Button className="mt-3" variant="secondary" onClick={() => setSheetOpen(true)}>
                    Manage SNI links
                  </Button>
                </div>
              </div>
            </Card>
            <Card>
              <div className="flex items-start gap-3 p-4">
                <Icon name="vpn_lock" size={18} className="mt-[2px] text-accent" />
                <div className="flex-1">
                  <h2 className="text-row font-semibold text-t1">Tunnels</h2>
                  <p className="mt-1 text-body text-t2">
                    {hasTunnels
                      ? `${tunnels?.tunnels.length} configured.`
                      : "None configured. The tunnel is an optional second stage."}
                  </p>
                  <Button
                    className="mt-3"
                    variant="secondary"
                    onClick={() => setTunnelSheetOpen(true)}
                  >
                    {hasTunnels ? "Manage tunnels" : "Add a tunnel"}
                  </Button>
                </div>
              </div>
            </Card>
          </div>
        )}

        {tab === "about" && (
          <div className="flex flex-col gap-4 px-5 py-5">
            <Card>
              <div className="flex items-start gap-3 p-4">
                <Icon name="info" size={18} className="mt-[2px] text-accent" />
                <div className="flex-1">
                  <h2 className="text-row font-semibold text-t1">Snifake</h2>
                  <p className="mt-1 text-body text-t2">
                    Identity, licence and updates.
                  </p>
                  <Button className="mt-3" variant="secondary" onClick={() => setAboutOpen(true)}>
                    Open About
                  </Button>
                </div>
              </div>
            </Card>
          </div>
        )}
      </TabRegion>

      <StatusFooter store={store} closeToTray={prefs.closeToTray} />

      {/* Interim: the Console's core installer, in the new modal frame.
          Task 10 replaces the body with the designed two-column screen. */}
      <ModalSheet
        open={coreSetupOpen}
        onOpenChange={setCoreSetupOpen}
        icon="memory"
        title="Set up the tunnel core"
        subtitle={core?.version ? `sing-box v${core.version}` : undefined}
        width={560}
        footer={
          <>
            <span className="text-note text-t2">The core is never bundled: it is GPL-3.0.</span>
            <Button variant="secondary" onClick={() => setCoreSetupOpen(false)}>
              Close
            </Button>
          </>
        }
      >
        <CoreSetup
          onInstalled={() => {
            setCoreSetupOpen(false);
            void invoke<CoreStatus>("core_status").then(setCore);
          }}
        />
      </ModalSheet>

      <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} onUpdateFound={setUpdate} />

      {store && (
      <ProfileSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        store={store}
        runningId={runningId}
        onSelect={(id) => void select(id)}
        onSave={(p) => void save(p)}
        onDelete={(id) => void remove(id)}
      />
      )}

      {tunnels && profile && (
        <TunnelSheet
          open={tunnelSheetOpen}
          onOpenChange={setTunnelSheetOpen}
          store={tunnels}
          listen={{ host: profile.LISTEN_HOST, port: profile.LISTEN_PORT }}
          connectIp={profile.CONNECT_IP}
          runningId={tunnelRunning ? tunnels.active_id : null}
          saving={false}
          onSelect={(id) =>
            void invoke<TunnelStore>("set_active_tunnel", { id }).then(setTunnels)
          }
          onSave={(t) => void saveTunnel(t)}
          onDelete={(id) =>
            void invoke<TunnelStore>("delete_tunnel", { id }).then(setTunnels)
          }
          onSaveRouting={(patch: {
            mode: TunnelMode;
            proxy_host: string;
            proxy_port: number;
            routing: Routing;
          }) =>
            void invoke<TunnelStore>("save_routing", patch)
              .then(setTunnels)
              .catch((e) => setErrorDialog(String(e)))
          }
          onAdoptAddress={(ip, port) =>
            void save({ ...profile, CONNECT_IP: ip, CONNECT_PORT: port })
          }
        />
      )}

      <AlertDialog open={exitDialogOpen} onOpenChange={setExitDialogOpen}>
        <AlertDialogContent className="prose-face">
          <AlertDialogHeader>
            <AlertDialogTitle>Quit Snifake?</AlertDialogTitle>
            <AlertDialogDescription>The proxy will be stopped.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmExit}>Quit</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmStopLink} onOpenChange={() => setConfirmStopLink(false)}>
        <AlertDialogContent className="prose-face">
          <AlertDialogHeader>
            <AlertDialogTitle>Stop the link?</AlertDialogTitle>
            <AlertDialogDescription>
              The tunnel runs through it and will stop too.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmStopLink(false);
                void stopBoth();
              }}
            >
              Stop both
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDelete !== null} onOpenChange={() => setConfirmDelete(null)}>
        <AlertDialogContent className="prose-face">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete the running profile?</AlertDialogTitle>
            <AlertDialogDescription>
              The proxy will be stopped before the profile is removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmRemove}>Stop and delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={update !== null} onOpenChange={() => !updating && setUpdate(null)}>
        <AlertDialogContent className="prose-face">
          <AlertDialogHeader>
            <AlertDialogTitle>Version {update?.version} is available</AlertDialogTitle>
            <AlertDialogDescription>
              {!updating
                ? "It will be downloaded and installed, then Snifake restarts."
                : downloading
                  ? "Snifake will restart once the download is installed."
                  : "Installing. Snifake will restart when it finishes."}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {updating && <UpdateMeter progress={progress} />}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={updating}>Later</AlertDialogCancel>
            <AlertDialogAction
              disabled={updating}
              onClick={(e) => {
                // The dialog must stay up while the download runs, so this
                // action does not get to close it.
                e.preventDefault();
                if (!update) return;
                setUpdating(true);
                setProgress(null);
                void applyUpdate(update, setProgress).catch((err) => {
                  setUpdating(false);
                  setProgress(null);
                  setUpdate(null);
                  setErrorDialog(`Update: ${err}`);
                });
              }}
            >
              {!updating ? "Install" : downloading ? "Downloading…" : "Installing…"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={errorDialog !== null} onOpenChange={() => setErrorDialog(null)}>
        <AlertDialogContent className="prose-face">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {errorDialog?.startsWith("Update:") ? "Update failed" : "Could not start the proxy"}
            </AlertDialogTitle>
            <AlertDialogDescription className="pick font-mono text-[11px] break-all">
              {errorDialog}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setErrorDialog(null)}>OK</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
