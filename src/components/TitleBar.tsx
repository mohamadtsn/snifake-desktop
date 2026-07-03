import { getCurrentWindow } from "@tauri-apps/api/window";

export function TitleBar() {
  const appWindow = getCurrentWindow();

  return (
    <div
      data-tauri-drag-region
      className="relative z-10 flex h-11 items-center gap-2 rounded-t-[28px] border-b border-white/10 bg-white/5 px-4 py-1.5 backdrop-blur-xl"
    >
      <img src="/icon.png" alt="" className="h-5 w-5" data-tauri-drag-region />
      <span
        data-tauri-drag-region
        className="text-[13px] font-semibold text-text"
      >
        SNI Spoof
      </span>
      <div className="flex-1" data-tauri-drag-region />
      <button
        onClick={() => appWindow.hide()}
        title="Send to tray"
        className="flex h-6 w-7 items-center justify-center rounded-md text-text-dim transition-colors hover:bg-surface-light hover:text-white"
      >
        ⌄
      </button>
      <button
        onClick={() => appWindow.minimize()}
        className="flex h-6 w-7 items-center justify-center rounded-md text-text-dim transition-colors hover:bg-surface-light hover:text-white"
      >
        –
      </button>
      <button
        onClick={() => appWindow.close()}
        className="flex h-6 w-7 items-center justify-center rounded-md text-text-dim transition-colors hover:bg-danger hover:text-white"
      >
        ×
      </button>
    </div>
  );
}