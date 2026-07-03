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
import { StatusCard } from "@/components/StatusCard";
import { ConfigForm, ConfigFormHandle } from "@/components/ConfigForm";
import { ActionBar } from "@/components/ActionBar";
import { LogPanel } from "@/components/LogPanel";
import { Config, ProxyState } from "@/types";

const MAX_LOG_LINES = 500;

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
  const [logs, setLogs] = useState<string[]>([]);
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
    const unlistenLog = listen<string>("log-message", (e) =>
      setLogs((prev) => [...prev, e.payload].slice(-MAX_LOG_LINES))
    );
    const unlistenTrayStart = listen("frontend-start-requested", () => handleStart());
    const unlistenTrayStop = listen("frontend-stop-requested", () => handleStop());
    const unlistenQuit = listen("frontend-quit-requested", () => setExitDialogOpen(true));

    return () => {
      unlistenState.then((f) => f());
      unlistenLog.then((f) => f());
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
    setLogs((prev) => [...prev, "Config saved"].slice(-MAX_LOG_LINES));
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
    <div className="relative flex h-screen flex-col overflow-hidden rounded-[28px] border border-border bg-bg">
      <div className="pointer-events-none absolute inset-x-0 -top-32 h-72 bg-[radial-gradient(closest-side,theme(colors.primary/22%),transparent)]" />
      <TitleBar />
      <div className="relative z-10 flex min-h-0 flex-1 flex-col gap-3 p-3.5">
        <StatusCard state={state} />
        <ConfigForm ref={formRef} initial={config} />
        <ActionBar
          state={state}
          autostart={autostart}
          onStart={handleStart}
          onStop={handleStop}
          onSave={handleSave}
          onExit={() => setExitDialogOpen(true)}
          onAutostartToggle={handleAutostartToggle}
        />
        <LogPanel lines={logs} />
      </div>

      <AlertDialog open={exitDialogOpen} onOpenChange={setExitDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Exit SNI Spoof</AlertDialogTitle>
            <AlertDialogDescription>
              Quit SNI Spoof and stop the proxy?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>No</AlertDialogCancel>
            <AlertDialogAction onClick={confirmExit}>Yes</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={errorDialog !== null} onOpenChange={() => setErrorDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Invalid Configuration</AlertDialogTitle>
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