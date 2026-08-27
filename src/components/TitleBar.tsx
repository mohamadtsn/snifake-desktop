import { getCurrentWindow } from "@tauri-apps/api/window";
import { ProxyState, STATE_COLOR, STATE_TEXT } from "@/types";

/**
 * The bezel. It carries the product name as engraved caps and the current
 * condition as a small readout on the right, so the state is legible even
 * when the window is scrolled or the sheet is open over the console.
 *
 * Window controls are drawn as glyphs rather than icon-library components:
 * at 10px an outlined lucide stroke reads as fuzz, and these three shapes
 * are two lines of SVG each.
 */
export function TitleBar({ state }: { state: ProxyState }) {
  const appWindow = getCurrentWindow();

  return (
    <header
      data-tauri-drag-region
      className="border-line relative z-10 flex h-9 shrink-0 items-center gap-2.5 border-b px-3"
    >
      <span
        data-tauri-drag-region
        className="text-dim text-[10px] uppercase"
        style={{ letterSpacing: "var(--track-engrave)" }}
      >
        Snifake
      </span>

      <span className="bg-line h-3 w-px shrink-0" aria-hidden />

      <span
        data-tauri-drag-region
        className="text-[9.5px] uppercase"
        style={{ letterSpacing: "var(--track-engrave)", color: STATE_COLOR[state] }}
      >
        {STATE_TEXT[state]}
      </span>

      <span className="flex-1" data-tauri-drag-region />

      <ChromeButton label="Send to tray" onClick={() => void appWindow.hide()}>
        <path d="M2 4l4 4 4-4" />
      </ChromeButton>
      <ChromeButton label="Minimize" onClick={() => void appWindow.minimize()}>
        <path d="M2 6h8" />
      </ChromeButton>
      <ChromeButton label="Quit" danger onClick={() => void appWindow.close()}>
        <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" />
      </ChromeButton>
    </header>
  );
}

function ChromeButton({
  label,
  onClick,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={[
        "text-faint flex size-6 items-center justify-center rounded-[var(--radius-chip)]",
        "transition-colors duration-[var(--dur-fast)] focus-visible:outline-none",
        "focus-visible:border-live focus-visible:text-text border border-transparent",
        danger ? "hover:bg-st-error hover:text-white" : "hover:bg-hover hover:text-text",
      ].join(" ")}
    >
      <svg
        viewBox="0 0 12 12"
        className="size-3"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinecap="round"
        aria-hidden
      >
        {children}
      </svg>
    </button>
  );
}
