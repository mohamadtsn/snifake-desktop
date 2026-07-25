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
import { StatusHero } from "@/components/StatusHero";
import { PrimaryAction } from "@/components/PrimaryAction";
import { ConnectionSection, ConfigFormHandle } from "@/components/ConnectionSection";
import { ActivitySection } from "@/components/ActivitySection";
import { SettingsRow } from "@/components/SettingsRow";
import { Config, ProxyState } from "@/types";

const DEFAULT_CONFIG: Config = {
  LISTEN_HOST: "127.0.0.1",
  LISTEN_PORT: 40443,
  CONNECT_IP: "103.160.204.34",
  CONNECT_PORT: 443,
  FAKE_SNI: "chatgpt.com",
};

export default function App() {
  const [config, setConfig] = useState<Config>(DEFAULT_CONFIG);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [state, setState] = useState<ProxyState>("stopped");
  const [autostart, setAutostart] = useState(false);
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [exitDialogOpen, setExitDialogOpen] = useState(false);
  const [errorDialog, setErrorDialog] = useState<string | null>(null);
  const formRef = useRef<ConfigFormHandle>(null);

  useEffect(() => {
    (async () => {
      const [loadedConfig, autostartEnabled] = await Promise.all([
        invoke<Config>("load_config"),
        invoke<boolean>("get_autostart_enabled"),
      ]);
      setConfig(loadedConfig);
      setAutostart(autostartEnabled);
      setConfigLoaded(true);
    })();
  }, []);

  useEffect(() => {
    const unlistenState = listen<ProxyState>("state-changed", (e) => setState(e.payload));
    const unlistenTrayStart = listen("frontend-start-requested", () => handleStart());
    const unlistenTrayStop = listen("frontend-stop-requested", () => handleStop());
    const unlistenQuit = listen("frontend-quit-requested", () => setExitDialogOpen(true));

    return () => {
      unlistenState.then((f) => f());
      unlistenTrayStart.then((f) => f());
      unlistenTrayStop.then((f) => f());
      unlistenQuit.then((f) => f());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function currentConfigOrWarn(): Config | null {
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

  async function handleStart() {
    const value = currentConfigOrWarn();
    if (!value) return;
    setConfig(value);
    await invoke("start_proxy", { cfg: value });
  }

  async function handleStop() {
    await invoke("stop_proxy");
  }

  async function handleSave() {
    const value = currentConfigOrWarn();
    if (!value) return;
    setConfig(value);
    await invoke("save_config", { cfg: value });
  }

  async function handleAutostartToggle(checked: boolean) {
    setAutostart(checked);
    await invoke("set_autostart", { enable: checked });
  }

  async function confirmExit() {
    await invoke("stop_proxy");
    await getCurrentWindow().destroy();
  }

  if (!configLoaded) return null;

  return (
    <div className="shell flex h-screen flex-col overflow-hidden">
      <TitleBar />

      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-4 pt-1 pb-4">
        <StatusHero state={state} sni={config.FAKE_SNI} />
        <PrimaryAction state={state} onStart={handleStart} onStop={handleStop} />
        <ConnectionSection
          ref={formRef}
          initial={config}
          saved={config}
          onSave={handleSave}
          open={connectionOpen}
          onOpenChange={setConnectionOpen}
        />
        <ActivitySection open={activityOpen} onOpenChange={setActivityOpen} />
        <div className="flex-1" />
        <div className="h-px bg-hairline" />
        <SettingsRow autostart={autostart} onAutostartToggle={handleAutostartToggle} />
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
