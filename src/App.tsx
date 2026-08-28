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
import { TitleBar } from "@/components/TitleBar";
import { StatusPanel } from "@/components/StatusPanel";
import { PowerSwitch } from "@/components/PowerSwitch";
import { RouteRows } from "@/components/RouteRows";
import { ProfileSelect } from "@/components/ProfileSelect";
import { ProfileSheet } from "@/components/ProfileSheet";
import { ActivitySection } from "@/components/ActivitySection";
import { AboutDialog } from "@/components/AboutDialog";
import { Profile, ProxyState, Store, activeProfile } from "@/types";
import { applyUpdate, findUpdate, type Progress } from "@/lib/updater";
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

  // The tray listeners are registered once on mount, so the handlers they
  // close over must read live state through refs, not stale captures.
  const storeRef = useRef<Store | null>(null);
  const runningRef = useRef<string | null>(null);
  storeRef.current = store;
  runningRef.current = runningId;

  useEffect(() => {
    void invoke<Store>("list_profiles").then(setStore);
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
          <StatusPanel state={state} since={since} />
          <RouteRows profile={profile} />
          <ProfileSelect
            profiles={store.profiles}
            activeId={store.active_id}
            runningId={runningId}
            onSelect={(id) => void select(id)}
            onManage={() => setSheetOpen(true)}
          />
        </main>

        {/* Outside the scroller: the switch and the log rule are fixed
            furniture. The primary control must never scroll off. */}
        <div className="border-line shrink-0 border-t px-4 pt-3 pb-3">
          <PowerSwitch state={state} onStart={() => void start()} onStop={() => void stop()} />
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
            <AlertDialogDescription className="font-mono text-[11px] break-all">
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

/**
 * Real bytes, never a fake sweep to fill the wait — except when the server
 * sends no content-length, and then the bar says exactly that by refusing to
 * claim a position.
 */
function UpdateMeter({ progress }: { progress: Progress | null }) {
  const total = progress?.total ?? null;
  const received = progress?.received ?? 0;
  const fraction = total ? Math.min(received / total, 1) : 0;

  return (
    <div className="mt-3">
      <div
        className="meter"
        data-indeterminate={total === null ? "" : undefined}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total ?? undefined}
        aria-valuenow={total ? received : undefined}
      >
        {/* No inline transform while indeterminate: it would win over the
            sweep's own scaleX and leave a bar of zero width. */}
        <div
          className="meter-fill"
          style={total ? { transform: `scaleX(${fraction})` } : undefined}
        />
      </div>
      <p className="value-face text-dim pick mt-1.5 text-[10.5px] leading-none" dir="ltr">
        {total === null
          ? `${mib(received)} MB`
          : `${mib(received)} / ${mib(total)} MB · ${Math.round(fraction * 100)}%`}
      </p>
    </div>
  );
}

const mib = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);
