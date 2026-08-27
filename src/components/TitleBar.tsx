import { getCurrentWindow } from "@tauri-apps/api/window";
import { ChevronDown, Minus, X } from "lucide-react";

const chromeButton =
  "flex h-6 w-6 items-center justify-center rounded-md text-faint " +
  "transition-colors duration-150 hover:bg-raised-hover hover:text-text " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60";

export function TitleBar() {
  const appWindow = getCurrentWindow();

  return (
    <div
      data-tauri-drag-region
      className="relative z-10 flex h-10 shrink-0 items-center gap-2 border-b border-hairline px-3"
    >
      <img src="/icon.png" alt="" className="size-4" data-tauri-drag-region />
      <span
        data-tauri-drag-region
        className="text-dim text-[12px] font-medium"
        style={{ letterSpacing: "var(--track-caption)" }}
      >
        SNI Spoof
      </span>
      <div className="flex-1" data-tauri-drag-region />
      <button onClick={() => appWindow.hide()} title="Send to tray" className={chromeButton}>
        <ChevronDown className="size-3.5" />
      </button>
      <button onClick={() => appWindow.minimize()} title="Minimize" className={chromeButton}>
        <Minus className="size-3.5" />
      </button>
      <button
        onClick={() => appWindow.close()}
        title="Quit"
        className={`${chromeButton} hover:bg-st-error/85 hover:text-white`}
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
