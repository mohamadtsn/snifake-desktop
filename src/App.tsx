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
import { PowerDisc } from "@/components/PowerDisc";
import { RouteRows } from "@/components/RouteRows";
import { ProfileBar } from "@/components/ProfileBar";
import { ProfileSheet } from "@/components/ProfileSheet";
import { ActivitySection } from "@/components/ActivitySection";
import { Profile, ProxyState, Store, activeProfile } from "@/types";

export default function App() {
  const [store, setStore] = useState<Store | null>(null);
  const [state, setState] = useState<ProxyState>("stopped");
  /** Which profile the engine is actually running. Not the same as active. */
  const [runningId, setRunningId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [exitDialogOpen, setExitDialogOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [errorDialog, setErrorDialog] = useState<string | null>(null);

  // The tray listeners are registered once on mount, so the handlers they
  // close over must read live state through refs, not stale captures.
  const storeRef = useRef<Store | null>(null);
  const runningRef = useRef<string | null>(null);
  storeRef.current = store;
  runningRef.current = runningId;

  useEffect(() => {
    void invoke<Store>("list_profiles").then(setStore);
  }, []);

  useEffect(() => {
    const unlistenState = listen<ProxyState>("state-changed", (e) => {
      setState(e.payload);
      if (e.payload === "stopped" || e.payload === "error") setRunningId(null);
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
  }

  /**
   * Selecting a profile makes it active. If the proxy is running it also
   * switches over: the engine is already authenticated, so this costs no
   * password prompt and takes well under a second.
   */
  async function select(id: string) {
    setStore(await invoke<Store>("set_active_profile", { id }));
    setSheetOpen(false);
    if (runningRef.current !== null) await start(id);
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

  return (
    <div className="shell relative flex h-screen flex-col overflow-hidden">
      <div
        className="sheet-host flex min-h-0 flex-1 flex-col"
        data-pushed={sheetOpen ? "" : undefined}
        inert={sheetOpen}
      >
        <TitleBar />
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pt-3 pb-4">
          <ProfileBar profile={profile} state={state} onOpen={() => setSheetOpen(true)} />
          <PowerDisc state={state} onStart={() => void start()} onStop={() => void stop()} />
          <RouteRows profile={profile} />
          <div className="shrink-0">
            <ActivitySection open={activityOpen} onOpenChange={setActivityOpen} />
          </div>
        </div>
      </div>

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
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Quit SNI Spoof?</AlertDialogTitle>
            <AlertDialogDescription>The proxy will be stopped.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmExit}>Quit</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDelete !== null} onOpenChange={() => setConfirmDelete(null)}>
        <AlertDialogContent>
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

      <AlertDialog open={errorDialog !== null} onOpenChange={() => setErrorDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Could not start the proxy</AlertDialogTitle>
            <AlertDialogDescription>{errorDialog}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setErrorDialog(null)}>OK</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
