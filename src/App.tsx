import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
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
import { TitleBar } from "@/components/TitleBar";
import { StatusPanel } from "@/components/StatusPanel";
import { SwitchBank } from "@/components/SwitchBank";
import { RouteRows } from "@/components/RouteRows";
import { ChannelSelect } from "@/components/ChannelSelect";
import { ProfileSheet } from "@/components/ProfileSheet";
import { TunnelSheet } from "@/components/TunnelSheet";
import { CoreSetup } from "@/components/CoreSetup";
import { ActivitySection } from "@/components/ActivitySection";
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
  const [coreInstalled, setCoreInstalled] = useState(false);
  const [tunnelSheetOpen, setTunnelSheetOpen] = useState(false);
  const [confirmStopLink, setConfirmStopLink] = useState(false);

  // The tray listeners are registered once on mount, so the handlers they
  // close over must read live state through refs, not stale captures.
  const storeRef = useRef<Store | null>(null);
  const runningRef = useRef<string | null>(null);
  storeRef.current = store;
  runningRef.current = runningId;

  useEffect(() => {
    void invoke<Store>("list_profiles").then(setStore);
    void invoke<TunnelStore>("list_tunnels").then(setTunnels);
    void invoke<{ installed: boolean }>("core_status").then((s) => setCoreInstalled(s.installed));
  }, []);

  // One check per launch. Silent when we are current or the check fails.
  useEffect(() => {
    void findUpdate().then(setUpdate);
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

  // Room for the second row, and only ever more of it: a window the user
  // made bigger stays that size.
  //
  // 660, not the 560 this plan first guessed. DESIGN.md 3 sizes the window
  // to its content with the log closed, and measured in a browser at the
  // real width the two-stage column is 497px inside 160px of chrome. At 560
  // the channel selectors started 8px below the fold, which is the one thing
  // this row exists to keep in reach.
  useEffect(() => {
    const target = (tunnels?.tunnels.length ?? 0) > 0 ? 660 : 504;
    void getCurrentWindow()
      .innerSize()
      .then((size) => {
        if (size.height >= target) return;
        return getCurrentWindow().setSize(new LogicalSize(420, target));
      });
  }, [tunnels]);

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

  async function confirmExit() {
    await invoke("stop_proxy");
    await invoke("shutdown_engine");
    await getCurrentWindow().destroy();
  }

  if (!store) return null;
  const profile = activeProfile(store);
  if (!profile) return null;

  // Two phases, one flow. `Finished` reports total === received, so the
  // download is over exactly when they meet; before the first event there is
  // no progress object yet and we are certainly still downloading.
  const downloading =
    !progress || progress.total === null || progress.received < progress.total;

  const hasTunnels = (tunnels?.tunnels.length ?? 0) > 0;
  const blockedReason = canStartTunnel(state, coreInstalled, tunnels?.active_id != null);
  const tunnelRunning = tunnelState !== "offline";

  return (
    <div className="shell relative flex h-screen flex-col overflow-hidden">
      {/* The bezel sits outside the sheet host on purpose: the drawer stops
          below it, so quit and minimise stay reachable while a sheet is
          open. Inside the host it would be dimmed and inert, and the only
          way out of the profile drawer would be the drawer itself. */}
      <TitleBar state={state} onAbout={() => setAboutOpen(true)} />

      <div
        className="sheet-host flex min-h-0 flex-1 flex-col"
        data-pushed={sheetOpen ? "" : undefined}
        inert={sheetOpen}
      >
        {/* One column, four blocks, one rhythm. The blocks are separated by
            engraved rules rather than cards: a console is a single panel
            with sections silkscreened onto it. */}
        <main className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pt-4 pb-3">
          <StatusPanel
            state={state}
            since={since}
            tunnel={hasTunnels ? tunnelState : undefined}
            tunnelSince={tunnelSince}
            tunnelMode={tunnels?.mode.replace("_", " ")}
          />
          <RouteRows profile={profile} />

          {/* Only once a tunnel exists. Asking someone to fetch a 24 MB core
              before they have said they want the feature is a toll on the
              way in. */}
          {hasTunnels && !coreInstalled && (
            <CoreSetup onInstalled={() => setCoreInstalled(true)} />
          )}

          {/* One rule over both rows: they are two of the same kind of
              thing, and two headings would be two rules where one belongs. */}
          <section className="flex shrink-0 flex-col gap-2.5">
            {/* The heading carries the way in, because the tunnel row
                below it only exists once a tunnel does — and without this
                there would be no way to create the first one. A chip on the
                engraved rule rather than an empty row: someone who never
                wants a tunnel should not be given one to dismiss. */}
            <div className="flex items-center gap-2">
              <h2 className="engrave flex-1">Channels</h2>
              <button
                type="button"
                onClick={() => setTunnelSheetOpen(true)}
                className="chip h-6 shrink-0 px-2 text-[10px]"
              >
                {hasTunnels ? "Tunnels" : "+ Tunnel"}
              </button>
            </div>
            <ChannelSelect
              items={store.profiles}
              activeId={store.active_id}
              runningId={runningId}
              manageLabel="Manage profiles"
              subtitle={(p) =>
                `${p.LISTEN_HOST}:${p.LISTEN_PORT} \u2192 ${p.CONNECT_IP}:${p.CONNECT_PORT}`
              }
              onSelect={(id) => void select(id)}
              onManage={() => setSheetOpen(true)}
            />
            {hasTunnels && tunnels && (
              <ChannelSelect
                items={tunnels.tunnels}
                activeId={tunnels.active_id}
                runningId={tunnelRunning ? tunnels.active_id : null}
                manageLabel="Manage tunnels"
                subtitle={(t) => `${t.protocol} \u00b7 ${t.remote_host}${t.path}`}
                onSelect={(id) =>
                  void invoke<TunnelStore>("set_active_tunnel", { id }).then(setTunnels)
                }
                onManage={() => setTunnelSheetOpen(true)}
              />
            )}
          </section>
        </main>

        {/* Outside the scroller: the switch and the log rule are fixed
            furniture. The primary control must never scroll off. */}
        <div className="border-line shrink-0 border-t px-4 pt-3 pb-3">
          <SwitchBank
            link={state}
            tunnel={tunnelState}
            showTunnel={hasTunnels}
            disabledReason={blockedReason}
            onLinkStart={() => void start()}
            // Stopping the link takes the tunnel with it, so it is a
            // decision rather than a reflex once the tunnel is up.
            onLinkStop={() => (tunnelRunning ? setConfirmStopLink(true) : void stop())}
            onTunnelStart={() => void startTunnel()}
            onTunnelStop={() => void stopTunnel()}
          />
          <div className="mt-2">
            <ActivitySection open={activityOpen} onOpenChange={setActivityOpen} />
          </div>
        </div>
      </div>

      <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} onUpdateFound={setUpdate} />

      <ProfileSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        store={store}
        runningId={runningId}
        onSelect={(id) => void select(id)}
        onSave={(p) => void save(p)}
        onDelete={(id) => void remove(id)}
      />

      {tunnels && (
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
