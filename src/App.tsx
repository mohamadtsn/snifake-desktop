import { useCallback, useEffect, useRef, useState } from "react";
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
  activeTunnel,
  type TunnelProfile,
  type TunnelState,
  type TunnelStore,
  TUNNEL_STATE_TEXT,
} from "@/types";
import { canStartTunnel, chainStep, nextTunnelState, shouldResumeTunnel, tunnelStartPlan } from "@/lib/tunnelMachine";
import { showRecovery } from "@/lib/recovery";
import { modeTransition, type Transition } from "@/lib/modeTransition";
import { clearDraft, LEAVE_COPY, leaveDecision, QUIT_COPY } from "@/lib/leaveGuard";
import type { DraftOwner, DraftReport } from "@/lib/leaveGuard";
import { rateBetween, type Rate, type Sample } from "@/lib/traffic";
import { applyUpdate, findUpdate, type Progress } from "@/lib/updater";
import { listenAddress, middleTruncate, tunnelInbound, type CoreStatus } from "@/lib/readouts";
import type { Update } from "@tauri-apps/plugin-updater";

export default function App() {
  const [store, setStore] = useState<Store | null>(null);
  const [state, setState] = useState<ProxyState>("stopped");
  /** Which profile the engine is actually running. Not the same as active. */
  const [runningId, setRunningId] = useState<string | null>(null);
  /** When the engine came up, for the uptime readout. */
  const [since, setSince] = useState<number | null>(null);
  /** How long the link had been up at the moment it faulted, in ms. The
   *  clock stops rather than resetting: "it ran for two minutes and then
   *  died" is the useful fact, and `00:00:00` is not. Cleared on the next
   *  clean stop or start. */
  const [frozenSince, setFrozenSince] = useState<number | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);
  const [exitDialogOpen, setExitDialogOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  /** The one draft on screen, if any, as its owner last reported it. A
   *  ref: owners report on every keystroke, and a re-render of the whole
   *  shell per keystroke buys nothing - the decision is read only at the
   *  moment of an exit. `draftDirty` mirrors just the flag, for the Quit
   *  dialog's sentence, and changes only when the flag does. */
  const draftRef = useRef<DraftReport | null>(null);
  const [draftDirty, setDraftDirty] = useState<DraftOwner | null>(null);
  const reportDraft = useCallback((report: DraftReport | null, owner: DraftOwner) => {
    draftRef.current = report ?? clearDraft(draftRef.current, owner);
    const dirtyOwner = draftRef.current?.dirty ? draftRef.current.owner : null;
    setDraftDirty((prev) => (prev === dirtyOwner ? prev : dirtyOwner));
  }, []);
  /** An exit waiting on the unsaved-changes question. */
  const [pendingLeave, setPendingLeave] = useState<{
    proceed: () => void;
    owner: DraftOwner;
    saveBlocked: string | null;
  } | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);
  /** The owner the leave dialog last asked about, so its sentence does not
   *  go blank during the close animation after `pendingLeave` clears. */
  const leaveOwner = useRef<DraftOwner>("sockets");
  if (pendingLeave) leaveOwner.current = pendingLeave.owner;
  /** A pending Activate that needs the restart warning answered first. */
  const [confirmActivate, setConfirmActivate] = useState<{
    kind: "sni" | "tunnel";
    id: string;
    name: string;
  } | null>(null);
  /** A failure to show, with what it was about. The title was guessed from
   *  a string prefix, so a failed clipboard write told the user the SNI link
   *  could not start. */
  const [errorDialog, setErrorDialog] = useState<{ title: string; message: string } | null>(null);
  const fail = (title: string) => (e: unknown) =>
    setErrorDialog({ title, message: String(e) });
  const [update, setUpdate] = useState<Update | null>(null);
  const [updating, setUpdating] = useState(false);
  /** Whether the offer dialog is showing. Separate from `update`: closing
   *  the offer hides it, and must not throw away the update it found -
   *  About keeps showing it and can still install it. */
  const [offerOpen, setOfferOpen] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);

  // The optional second stage. `tunnels === null` only until the first load
  // resolves; an empty store is the normal, shipped state.
  const [tunnels, setTunnels] = useState<TunnelStore | null>(null);
  const [tunnelState, setTunnelState] = useState<TunnelState>("offline");
  const [tunnelSince, setTunnelSince] = useState<number | null>(null);
  const [core, setCore] = useState<CoreStatus | null>(null);
  /** `sysproxy::support()`'s reason, or `null` when this desktop can have
   *  its proxy written. Asked once: it reports what is installed. */
  const [systemProxyBlocked, setSystemProxyBlocked] = useState<string | null>(null);
  /** `tun_support()`: `null` when TUN can run on this machine. */
  const [tunBlocked, setTunBlocked] = useState<string | null>(null);
  /** A TUN session ended without reporting its kill switch down. */
  const [tunLeftover, setTunLeftover] = useState(false);
  const [restoring, setRestoring] = useState(false);

  // Live throughput. The engine sends cumulative totals once a second; the
  // rate is derived from two of them, and every case where it cannot be
  // derived is a `null` that renders as a dash. See `lib/traffic.ts`.
  //
  // The previous sample is a ref, not state: it is arithmetic input that is
  // never rendered, and holding it in state would mean deriving the rate
  // inside a state updater - work React is allowed to run twice.
  const previousSample = useRef<Sample | null>(null);
  const [rate, setRate] = useState<Rate>({ up: null, down: null });
  const [total, setTotal] = useState<{ up: number; down: number } | null>(null);
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
  /** Read by the once-mounted listeners, which cannot see fresh state. */
  const tunnelStateRef = useRef<TunnelState>("offline");
  const tunnelsRef = useRef<TunnelStore | null>(null);
  /** The link's state, for the once-mounted listeners. */
  const stateRef = useRef<ProxyState>("stopped");
  /** A tunnel start that is waiting for the link it dials to come up.
   *  A ref, not state: it is read by the once-mounted `state-changed`
   *  listener, and nothing renders it - the tunnel's own `starting` does. */
  const tunnelAfterLink = useRef(false);
  storeRef.current = store;
  runningRef.current = runningId;
  tunnelStateRef.current = tunnelState;
  tunnelsRef.current = tunnels;
  stateRef.current = state;

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
    // Only this silent check opens the offer. A check pressed on About
    // reports into About's own panel, which is already on screen.
    void findUpdate().then((found) => {
      setUpdate(found);
      setOfferOpen(found !== null);
    });
    // Deliberately on mount only. Turning the preference on mid-session
    // should not fire a check the user did not ask for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const unlistenState = listen<ProxyState>("state-changed", (e) => {
      setState(e.payload);
      if (tunnelAfterLink.current) {
        const step = chainStep(e.payload);
        if (step === "start-tunnel") {
          tunnelAfterLink.current = false;
          void startTunnel();
        } else if (step === "abandon") {
          abandonTunnelChain();
        }
      }
      // The clock starts when the engine reports it is up, not when we asked
      // it to start: elevation prompts can sit for a minute.
      if (e.payload === "running") {
        setSince((prev) => prev ?? Date.now());
        setFrozenSince(null);
      }
      if (e.payload === "stopped" || e.payload === "error") {
        setRunningId(null);
        // A fault keeps its elapsed time; a clean stop does not.
        setSince((prev) => {
          setFrozenSince(e.payload === "error" && prev !== null ? Date.now() - prev : null);
          return null;
        });
      }
    });
    const unlistenStart = listen("frontend-start-requested", () => void start());
    // Not `stop()`. The engine's Stop takes only the SNI stage, leaving the
    // tunnel holding - and the OS proxy still pointed at a sing-box whose
    // outbound has nothing left to dial. The in-window switch asks first;
    // the tray's Stop is already an explicit command, and a dialog behind a
    // hidden window would just look like nothing happened.
    const unlistenStop = listen("frontend-stop-requested", () => {
      void (tunnelStateRef.current === "offline" ? stop() : stopBoth());
    });
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
    const un = listen<{ state: TunnelState; detail: string | null; blocking: boolean }>(
      "tunnel-state-changed",
      (e) => {
        setTunnelState(e.payload.state);
        // The marker is deleted in Rust on the engine's word; this only
        // re-reads it. `offline` is also what the host synthesises when the
        // engine dies, which is exactly when the banner has to appear.
        if (e.payload.state === "offline") refreshLeftover();
        // Started when the engine says it is up, not when we asked — the
        // same call App already makes for the link's clock.
        setTunnelSince(e.payload.state === "active" ? Date.now() : null);
        // `modeTransition` refuses to set an OS proxy for a tunnel that is
        // only *starting*, because it might never open the port. This is
        // the other half of that: once it is actually up, reconcile the
        // setting to the stored mode. `sysproxy::apply` keeps the first
        // marker's `previous`, so calling it again is safe.
        if (e.payload.state === "active" && tunnelsRef.current?.mode === "system_proxy") {
          void invoke("apply_system_proxy").catch(() => {});
        }
        if (e.payload.state === "fault" && e.payload.detail) {
          setErrorDialog({ title: "The tunnel stopped", message: e.payload.detail });
        }
      },
    );
    return () => {
      void un.then((f) => f());
    };
  }, []);

  useEffect(() => {
    void invoke<string | null>("sysproxy_support").then(setSystemProxyBlocked).catch(() => {});
  }, []);

  useEffect(() => {
    void invoke<string | null>("tun_support").then(setTunBlocked).catch(() => {});
    refreshLeftover();
  }, []);

  useEffect(() => {
    const un = listen<string>("sysproxy-failed", (e) => {
      setErrorDialog({
        title: "The system proxy could not be set",
        message: `${e.payload}\n\nThe tunnel is running and the port is open; only the operating system setting failed. Point your applications at the port yourself, or choose Manual.`,
      });
    });
    return () => {
      void un.then((f) => f());
    };
  }, []);

  useEffect(() => {
    const un = listen<[number, number]>("traffic", (e) => {
      const next: Sample = { up: e.payload[0], down: e.payload[1], at: Date.now() };
      setRate(rateBetween(previousSample.current, next));
      previousSample.current = next;
      setTotal({ up: next.up, down: next.down });
    });
    return () => {
      void un.then((f) => f());
    };
  }, []);

  // A stopped stage has no reading at all - not a stale one. The last rate
  // before it stopped would sit on the face claiming traffic is moving.
  useEffect(() => {
    if (state === "running") return;
    previousSample.current = null;
    setRate({ up: null, down: null });
    setTotal(null);
  }, [state]);

  // The coupling: the tunnel cannot outlive the link it dials. Encoded once,
  // in tunnelMachine, so the rule is tested rather than scattered.
  useEffect(() => {
    setTunnelState((current) => nextTunnelState(current, state));
  }, [state]);

  // The engine stops the core when the link changes (a profile switch, a
  // restart) and reports `holding`. Once the link is back, start the tunnel
  // again with a config generated against the new link — in TUN the kill
  // switch has held the machine closed the whole time.
  useEffect(() => {
    if (shouldResumeTunnel(state, tunnelState)) void startTunnel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, tunnelState]);

  /** Only calls a setter, so the once-mounted listener may call it. */
  function refreshLeftover() {
    void invoke<boolean>("tun_leftover_status").then(setTunLeftover).catch(() => {});
  }

  /** Launches the engine if it is not running — it purges leftovers as its
   *  first act and reports the kill switch down, which deletes the marker. */
  async function restoreNetwork() {
    setRestoring(true);
    try {
      await invoke("restore_network");
    } catch (e) {
      fail("The network could not be restored")(e);
    } finally {
      setRestoring(false);
      refreshLeftover();
    }
  }

  // Reads the ref, not `tunnels`: the chained start calls this from the
  // once-mounted `state-changed` listener, whose closure is the first render.
  async function startTunnel() {
    const id = tunnelsRef.current?.active_id;
    if (!id) return abandonTunnelChain();
    try {
      await invoke("start_tunnel", { id });
    } catch (e) {
      abandonTunnelChain();
      fail("The tunnel could not start")(e);
    }
  }

  /**
   * The tunnel's power button. With the link down this is a link start
   * followed by a tunnel start: the tunnel shows `starting` for the whole
   * wait, including the elevation prompt, so the press visibly took.
   */
  async function requestTunnelStart() {
    const plan = tunnelStartPlan(stateRef.current);
    if (plan === "tunnel") return startTunnel();
    tunnelAfterLink.current = true;
    setTunnelState("starting");
    if (plan === "link-then-tunnel" && !(await start())) abandonTunnelChain();
  }

  /** The link is not coming up, or the tunnel's own start failed. A
   *  `starting` the engine never confirmed goes back to `offline`; any
   *  state the engine did report is left alone. */
  function abandonTunnelChain() {
    tunnelAfterLink.current = false;
    setTunnelState((s) => (s === "starting" ? "offline" : s));
  }

  async function stopTunnel() {
    // A press while the chain waits on the link is a cancel: without this
    // the tunnel would start after the user said stop.
    tunnelAfterLink.current = false;
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
    // One call, not stop-then-start: the engine replaces a running tunnel
    // itself, and in TUN a separate stop would lift the kill switch for the
    // gap between the two (spec §12.5).
    if (plan.restartTunnel && activeId) {
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

  async function start(id?: string): Promise<boolean> {
    const current = storeRef.current;
    const target = id ?? current?.active_id;
    if (!target) return false;
    try {
      await invoke("start_proxy", { id: target });
      setRunningId(target);
      return true;
    } catch (e) {
      fail("The SNI link could not start")(e);
      return false;
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

  /**
   * Activating a tunnel while one is running switches the running one over,
   * the same way `select` does for the link. Without this, pressing Activate
   * on a tunnel during a session sets a flag and changes nothing a user can
   * see - a control that does nothing, which is the class of defect this
   * whole pass exists to remove.
   */
  async function selectTunnel(id: string) {
    // Read the outgoing id before the store is changed under us.
    const wasActive = tunnels?.active_id ?? null;
    const next = await invoke<TunnelStore>("set_active_tunnel", { id });
    setTunnels(next);
    if (tunnelState === "active" && wasActive !== id) {
      setTunnelSince(null);
      await invoke("start_tunnel", { id });
    }
  }

  /**
   * The warning that used to sit at the foot of the profile list, moved to
   * the moment of the action and shown only when it is true. A warning
   * parked at the bottom of a column is not a warning; it is decoration that
   * happens to be correct. With the stage down, activating costs nothing and
   * nothing is asked.
   */
  function requestActivate(kind: "sni" | "tunnel", id: string) {
    const live = kind === "sni" ? state === "running" : tunnelState === "active";
    const name =
      kind === "sni"
        ? (store?.profiles.find((p) => p.id === id)?.name ?? "")
        : (tunnels?.tunnels.find((t) => t.id === id)?.name ?? "");
    if (live) {
      setConfirmActivate({ kind, id, name });
      return;
    }
    void activate(kind, id);
  }

  function activate(kind: "sni" | "tunnel", id: string) {
    return kind === "sni"
      ? select(id).catch(fail("The profile could not be activated"))
      : selectTunnel(id).catch(fail("The tunnel could not be activated"));
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
  /** Every exit that could discard a draft goes through here. */
  function guardLeave(proceed: () => void, staying = false) {
    const decision = leaveDecision(draftRef.current, staying);
    if (decision.kind === "go") return proceed();
    setPendingLeave({ proceed, owner: decision.owner, saveBlocked: decision.saveBlocked });
  }

  function requestTab(next: Tab) {
    guardLeave(() => setTab(next), next === tab);
  }

  async function saveAndLeave() {
    const pending = pendingLeave;
    const draft = draftRef.current;
    if (!pending || !draft) return;
    setSavingDraft(true);
    try {
      await draft.save();
      setPendingLeave(null);
      pending.proceed();
    } catch {
      // The save's own handler has already shown why. Stay, with the
      // draft intact, so the user can fix it.
      setPendingLeave(null);
    } finally {
      setSavingDraft(false);
    }
  }

  function closeWindow() {
    if (prefs.closeToTray) {
      void getCurrentWindow().hide();
    } else {
      setExitDialogOpen(true);
    }
  }

  /**
   * The one way an update starts, from the offer or from About. The offer
   * closes and the download is followed on About, because a modal held
   * open for a whole download traps the window for no reason. Moving to
   * About goes through the leave guard like any other tab change, and the
   * download starts only once the user has actually left: an update ends
   * in a relaunch, so starting it after "Keep editing" would discard the
   * draft the user just chose to keep. The update stays found, and About
   * can start it again.
   */
  function beginUpdate() {
    const found = update;
    if (!found || updating) return;
    setOfferOpen(false);
    guardLeave(() => {
      setTab("about");
      setUpdating(true);
      setProgress(null);
      void applyUpdate(found, setProgress).catch((err) => {
        setUpdating(false);
        setProgress(null);
        setUpdate(null);
        setErrorDialog({ title: "The update could not be applied", message: String(err) });
      });
    }, tab === "about");
  }

  async function confirmExit() {
    await invoke("stop_proxy");
    await invoke("shutdown_engine");
    await getCurrentWindow().destroy();
  }

  const profile = store ? activeProfile(store) : undefined;

  const blockedReason = canStartTunnel(coreInstalled, tunnels?.active_id != null);
  const tunnelRunning = tunnelState !== "offline";

  return (
    <div className="flex h-screen flex-col overflow-hidden rounded-[12px] bg-surface inset-ring-1 inset-ring-hairline-strong">
      <TitleBar
        tab={tab}
        onTabChange={requestTab}
        state={state}
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
            rate={rate}
            total={total}
            frozenSince={frozenSince}
            systemProxyBlocked={systemProxyBlocked}
            tunBlocked={tunBlocked}
            tunnelMode={tunnels?.mode ?? "system_proxy"}
            recovery={showRecovery(tunLeftover, tunnelState)}
            restoring={restoring}
            onRestoreNetwork={() => void restoreNetwork()}
            onResumeTunnel={() => void requestTunnelStart()}
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
            onTunnelToggle={(on) => (on ? void requestTunnelStart() : void stopTunnel())}
            onSelectProfile={(id) => requestActivate("sni", id)}
            onSelectTunnel={(id) => requestActivate("tunnel", id)}
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
            onDraftChange={reportDraft}
            systemProxyBlocked={systemProxyBlocked}
            tunBlocked={tunBlocked}
            onSave={(patch) => {
              setSavingRouting(true);
              const plan = modeTransition(
                tunnels?.mode ?? "manual",
                patch.mode,
                tunnelState === "active",
              );
              return invoke<TunnelStore>("save_routing", patch)
                .then(async (next) => {
                  setTunnels(next);
                  await reconcileMode(plan, next.active_id);
                })
                .catch((e) => {
                  fail("The routing rules could not be saved")(e);
                  throw e;
                })
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
              return save(p)
                .catch((e) => {
                  fail("The profile could not be saved")(e);
                  throw e;
                })
                .finally(() => setSavingProfile(false));
            }}
            onDeleteProfile={(id) => void remove(id)}
            onSelectProfile={(id) => requestActivate("sni", id)}
            onSaveTunnel={(t) => {
              setSavingProfile(true);
              return saveTunnel(t)
                .catch((e) => {
                  fail("The tunnel could not be saved")(e);
                  throw e;
                })
                .finally(() => setSavingProfile(false));
            }}
            onDraftChange={reportDraft}
            guardLeave={guardLeave}
            onDeleteTunnel={(id) =>
              void invoke<TunnelStore>("delete_tunnel", { id })
                .then(setTunnels)
                .catch(fail("The tunnel could not be deleted"))
            }
            onSelectTunnel={(id) => requestActivate("tunnel", id)}
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
            onInstall={beginUpdate}
          />
        )}
      </TabRegion>

      <StatusFooter
        link={profile ? listenAddress(profile) : null}
        linkLive={state === "running"}
        tunnel={tunnelInbound(tunnels)}
        tunnelLive={tunnelState === "active"}
        tunnelRemote={tunnels ? (activeTunnel(tunnels)?.remote_host ?? null) : null}
        rate={rate}
      />

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
        // The unsaved-rules warning rides on this dialog rather than
        // stacking a second one in front of it: quitting and discarding are
        // one decision, and two dialogs in a row is two chances to dismiss
        // the wrong one.
        description={
          (draftDirty ? `${QUIT_COPY[draftDirty]} ` : "") +
          (state === "running" || tunnelRunning
            ? "Quitting stops both stages and closes the elevated engine. Closing the window instead leaves everything running in the tray."
            : "Nothing is running. Quitting closes the window and the tray icon.")
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

      {/* Every exit that would discard a draft lands here. Three answers:
          keep editing, discard, or save and go - the last set apart on the
          leading edge because it is a different kind of answer. */}
      <ConfirmDialog
        open={pendingLeave !== null}
        onOpenChange={(open) => {
          if (!open && !savingDraft) setPendingLeave(null);
        }}
        tone="danger"
        icon="warning"
        title="Leave without saving?"
        description={`${LEAVE_COPY[leaveOwner.current]} Leaving discards them.`}
        busy={savingDraft}
        tertiary={{
          label: savingDraft ? "Saving" : "Save and leave",
          icon: "check",
          disabledReason: pendingLeave?.saveBlocked ?? null,
          onClick: () => void saveAndLeave(),
        }}
        cancelLabel="Keep editing"
        confirmLabel="Discard changes"
        onConfirm={() => {
          const pending = pendingLeave;
          setPendingLeave(null);
          pending?.proceed();
        }}
      />

      {/* The warning the profile list used to carry at its foot, at the
          moment of the action and only when it is true. */}
      <ConfirmDialog
        open={confirmActivate !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmActivate(null);
        }}
        tone="neutral"
        icon="bolt"
        title={
          confirmActivate?.kind === "tunnel"
            ? "Restart the tunnel on this profile?"
            : "Restart the engine into this profile?"
        }
        description={
          confirmActivate?.kind === "tunnel"
            ? "The tunnel is running. Activating this one restarts it on that profile, and every connection through it drops."
            : "The SNI link is running. Activating this one restarts it into that profile. There is no password prompt, but every connection through it drops."
        }
        details={
          <p className="mono text-note text-t1">
            {middleTruncate(confirmActivate?.name ?? "", 34)}
          </p>
        }
        cancelLabel="Keep running"
        confirmLabel="Activate and restart"
        onConfirm={() => {
          const pending = confirmActivate;
          setConfirmActivate(null);
          if (pending) void activate(pending.kind, pending.id);
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
        open={offerOpen && update !== null}
        onOpenChange={(open) => {
          if (!open) setOfferOpen(false);
        }}
        tone="neutral"
        icon="system_update_alt"
        title={`Snifake v${update?.version ?? ""} is available`}
        badge={<Badge tone="accent">v{update?.version ?? ""}</Badge>}
        description={`You are on v${update?.currentVersion ?? ""}. It will be downloaded, verified and installed, and Snifake restarts. You can follow it on About.`}
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
            <div className="flex items-center justify-between gap-3 border-t border-hairline pt-2">
              <span className="mono text-note text-t3">
                {update?.date ? `released ${update.date.slice(0, 10)}` : "release date unknown"}
              </span>
              <Badge tone="ok">signed</Badge>
            </div>
          </div>
        }
        cancelLabel="Later"
        confirmLabel="Update now"
        onConfirm={beginUpdate}
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
