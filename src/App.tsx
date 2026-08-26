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
import { StatusControl } from "@/components/StatusControl";
import { ConnectionSection, ConfigFormHandle } from "@/components/ConnectionSection";
import { ActivitySection } from "@/components/ActivitySection";
import { Profile, ProxyState, Store, activeProfile } from "@/types";

export default function App() {
  const [store, setStore] = useState<Store | null>(null);
  const [state, setState] = useState<ProxyState>("stopped");
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [exitDialogOpen, setExitDialogOpen] = useState(false);
  const [errorDialog, setErrorDialog] = useState<string | null>(null);
  const formRef = useRef<ConfigFormHandle>(null);

  useEffect(() => {
    void invoke<Store>("list_profiles").then(setStore);
  }, []);

  useEffect(() => {
    const unlistenState = listen<ProxyState>("state-changed", (e) => setState(e.payload));
    const unlistenTrayStart = listen("frontend-start-requested", () => void handleStart());
    const unlistenTrayStop = listen("frontend-stop-requested", () => void handleStop());
    const unlistenQuit = listen("frontend-quit-requested", () => setExitDialogOpen(true));

    return () => {
      unlistenState.then((f) => f());
      unlistenTrayStart.then((f) => f());
      unlistenTrayStop.then((f) => f());
      unlistenQuit.then((f) => f());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function editedProfileOrWarn(): Profile | null {
    const form = formRef.current;
    if (!form) return null;
    const { valid, error } = form.validate();
    if (!valid) {
      // Surface the offending field, not just the message.
      setConnectionOpen(true);
      setErrorDialog(error);
      return null;
    }
    return form.getValue();
  }

  /** Saves whatever is in the form, then starts that profile. */
  async function handleStart() {
    const edited = editedProfileOrWarn();
    if (!edited) return;
    setStore(await invoke<Store>("save_profile", { profile: edited }));
    try {
      await invoke("start_proxy", { id: edited.id });
    } catch (e) {
      setErrorDialog(String(e));
    }
  }

  async function handleStop() {
    await invoke("stop_proxy");
  }

  async function handleSave() {
    const edited = editedProfileOrWarn();
    if (!edited) return;
    setStore(await invoke<Store>("save_profile", { profile: edited }));
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
    <div className="shell flex h-screen flex-col overflow-hidden">
      <TitleBar />

      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-4 pt-3 pb-4">
        <StatusControl state={state} profile={profile} onStart={handleStart} onStop={handleStop} />
        <div className="shrink-0">
          <ConnectionSection
            key={profile.id}
            ref={formRef}
            initial={profile}
            saved={profile}
            onSave={handleSave}
            open={connectionOpen}
            onOpenChange={setConnectionOpen}
          />
        </div>
        <div className="shrink-0">
          <ActivitySection open={activityOpen} onOpenChange={setActivityOpen} />
        </div>
      </div>

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

      <AlertDialog open={errorDialog !== null} onOpenChange={() => setErrorDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Invalid configuration</AlertDialogTitle>
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
