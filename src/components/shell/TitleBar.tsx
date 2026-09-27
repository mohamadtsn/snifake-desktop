import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { Icon } from "@/components/ui/Icon";
import { Segmented } from "@/components/ui/Segmented";
import { StatusDot } from "@/components/ui/StatusDot";
import { isMac } from "@/lib/platform";
import { STATE_TEXT, type ProxyState } from "@/types";
import { TABS, type Tab } from "./TabRegion";
import { WindowControls } from "./WindowControls";
import appIcon from "../../../src-tauri/icons/128x128@2x.png";

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
 * 52px of fixed chrome: identity flush left, the four tabs at the window's
 * centre, what the application is doing on the right.
 *
 * The bar and its non-interactive parts are the window's drag surface, which
 * is the whole reason a frameless window still feels like a window.
 *
 * **The tab bar is centred on the window, absolutely, not laid out between
 * the two clusters.** Before, both sides reserved `CONTROLS_WIDTH` whether
 * or not the control cluster was on that side, so that the bar would land at
 * the same x on macOS as on Linux. That is compensation for a mis-centred
 * bar rather than a centred one: it has to be recomputed whenever either
 * cluster changes weight, and it centres on the space between the clusters,
 * which is not where the eye looks. Positioning in the window removes the
 * problem instead of balancing it, and the side clusters get a max-width so
 * they can never reach the tabs.
 *
 * The identity is the application icon rather than the word "Snifake",
 * imported from `src-tauri/icons/` - the directory the bundle's icons are
 * generated into - rather than kept as a copy under `public/`. A copy is how
 * the header went on showing the old globe after the mark was redrawn. 30px,
 * just under the 34px tab bar, so it reads as the window's identity rather
 * than as one more chip beside the version. The name is already on the
 * window and in the tray. The core pill that used to
 * sit on the right is gone: a missing core is stated by the tunnel actuator
 * that refuses to start, by `CoreSetupModal`, and by Preferences → Core with
 * the real path and digest. A pill that says `core v1.13.21` when everything
 * is fine is a readout nobody reads.
 */
export function TitleBar({
  tab,
  onTabChange,
  state,
  onClose,
  onPreferences,
}: {
  tab: Tab;
  onTabChange: (tab: Tab) => void;
  state: ProxyState;
  onClose: () => void;
  onPreferences: () => void;
}) {
  const [version, setVersion] = useState("");
  const mac = isMac();

  useEffect(() => {
    void getVersion().then(setVersion);
  }, []);

  return (
    <header
      data-tauri-drag-region
      className="relative flex h-[var(--h-titlebar)] shrink-0 items-center justify-between gap-3 border-b border-hairline bg-surface px-[10px]"
    >
      <div data-tauri-drag-region className="flex min-w-0 max-w-[31%] items-center gap-2">
        {mac ? <WindowControls mac onClose={onClose} /> : null}
        <img
          src={appIcon}
          alt=""
          aria-hidden
          data-tauri-drag-region
          className="size-[30px] shrink-0"
        />
        {version ? (
          <span className="mono shrink-0 rounded-xs border border-hairline bg-raised px-[6px] py-[2px] text-mini text-t2">
            v{version}
          </span>
        ) : null}
      </div>

      {/* Absolutely positioned, so the tab bar sits at the window's centre
          whatever the clusters beside it weigh. `pointer-events-none` on the
          full-width layer keeps the drag surface and the clusters reachable
          through it; only the control itself takes the pointer back. */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="pointer-events-auto">
          <Segmented
            role="tablist"
            label="Sections"
            value={tab}
            onChange={onTabChange}
            options={TABS}
            size="md"
          />
        </div>
      </div>

      <div
        data-tauri-drag-region
        className="flex min-w-0 max-w-[31%] items-center justify-end gap-[10px]"
      >
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

        {mac ? null : <WindowControls mac={false} onClose={onClose} />}
      </div>
    </header>
  );
}
