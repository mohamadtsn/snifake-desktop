import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { Icon } from "@/components/ui/Icon";
import { Segmented } from "@/components/ui/Segmented";
import { StatusDot } from "@/components/ui/StatusDot";
import { coreLabel, type CoreStatus } from "@/lib/readouts";
import { isMac } from "@/lib/platform";
import { STATE_TEXT, type ProxyState } from "@/types";
import { TABS, type Tab } from "./TabRegion";
import { CONTROLS_WIDTH, WindowControls } from "./WindowControls";

const TONE: Record<ProxyState, "off" | "ok" | "warn" | "bad"> = {
  stopped: "off",
  starting: "warn",
  running: "ok",
  error: "bad",
};

const TEXT: Record<ProxyState, string> = {
  stopped: "text-t3",
  starting: "text-warn",
  running: "text-ok",
  error: "text-bad",
};

/**
 * 52px of fixed chrome: identity on the left, the four tabs in the middle,
 * what the application is doing on the right.
 *
 * The bar and its non-interactive parts are the window's drag surface, which
 * is the whole reason a frameless window still feels like a window.
 *
 * Both sides reserve `CONTROLS_WIDTH` whether or not the control cluster is
 * on that side, so the tab bar sits at exactly the same x on macOS as on
 * Linux. Without that the nav would jump by 84px between platforms, and a
 * screenshot from one would be useless for the other.
 */
export function TitleBar({
  tab,
  onTabChange,
  state,
  core,
  onClose,
  onPreferences,
}: {
  tab: Tab;
  onTabChange: (tab: Tab) => void;
  state: ProxyState;
  core: CoreStatus | null;
  onClose: () => void;
  onPreferences: () => void;
}) {
  const [version, setVersion] = useState("");
  const mac = isMac();

  useEffect(() => {
    void getVersion().then(setVersion);
  }, []);

  const spacer = <span className="shrink-0" style={{ width: CONTROLS_WIDTH }} aria-hidden />;

  return (
    <header
      data-tauri-drag-region
      className="flex h-[var(--h-titlebar)] shrink-0 items-center justify-between gap-3 border-b border-hairline bg-surface px-3"
    >
      <div data-tauri-drag-region className="flex min-w-0 items-center gap-2">
        {mac ? <WindowControls mac onClose={onClose} /> : spacer}
        <span
          data-tauri-drag-region
          className="ml-1 shrink-0 text-row font-semibold tracking-[-0.325px] text-t1"
        >
          Snifake
        </span>
        {version ? (
          <span className="mono shrink-0 rounded-xs border border-hairline bg-raised px-[6px] py-[2px] text-mini text-t2">
            v{version}
          </span>
        ) : null}
      </div>

      <Segmented
        role="tablist"
        label="Sections"
        value={tab}
        onChange={onTabChange}
        options={TABS}
        size="sm"
      />

      <div data-tauri-drag-region className="flex min-w-0 items-center gap-[10px]">
        {/* The slot the mockup filled with a `12ms` latency pill. There is no
            probe and no measurement; there is a pinned core version, and
            whether it is on disk. */}
        <span className="flex min-w-0 shrink items-center gap-[6px] rounded-sm border border-hairline bg-inset px-[9px] py-[4px]">
          <Icon name="memory" size={13} className={core?.installed ? "text-t2" : "text-t3"} />
          <span className="mono truncate text-note text-t2">{coreLabel(core)}</span>
        </span>

        <span
          className={`flex shrink-0 items-center gap-[6px] rounded-sm border px-[9px] py-[4px] ${
            state === "running"
              ? "border-ok-line bg-ok-soft"
              : state === "error"
                ? "border-bad-line bg-bad-soft"
                : state === "starting"
                  ? "border-warn-line bg-warn-soft"
                  : "border-hairline bg-inset"
          }`}
        >
          <StatusDot tone={TONE[state]} size={6} glow={state === "running"} />
          <span className={`text-note font-medium ${TEXT[state]}`}>{STATE_TEXT[state]}</span>
        </span>

        <button
          type="button"
          aria-label="Preferences"
          title="Preferences"
          onClick={onPreferences}
          className="flex size-[26px] shrink-0 items-center justify-center rounded-sm text-t2 transition-[background-color,color,transform] duration-(--dur-press) ease-(--ease-out) hover:bg-raised-dim hover:text-t1 active:scale-[0.94]"
        >
          <Icon name="settings" size={15} />
        </button>

        {mac ? spacer : <WindowControls mac={false} onClose={onClose} />}
      </div>
    </header>
  );
}
