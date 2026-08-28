import { getCurrentWindow } from "@tauri-apps/api/window";
import { ProxyState, STATE_COLOR, STATE_TEXT } from "@/types";

/**
 * The bezel. It carries the product name as engraved caps and the current
 * condition as a small readout on the right, so the state is legible even
 * when the window is scrolled or the sheet is open over the console.
 *
 * Window controls are drawn as glyphs rather than icon-library components:
 * at 10px an outlined lucide stroke reads as fuzz, and these two shapes
 * are two lines of SVG each.
 */
export function TitleBar({ state, onAbout }: { state: ProxyState; onAbout: () => void }) {
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

      {/* About sits with the window controls but on its own side of a
          hairline: it acts on the app, the other two act on the window.
          This is the bezel affordance every desktop already trains for —
          GNOME's header-bar menu, Windows' Help, macOS' app menu — so it
          costs no discovery. */}
      <ChromeButton label="About Snifake" onClick={onAbout}>
        <circle cx="6" cy="6" r="4.6" />
        <path d="M6 5.4v2.7" />
        <path d="M6 3.8v.1" />
      </ChromeButton>

      <span className="bg-line mx-0.5 h-3.5 w-px shrink-0" aria-hidden />

      <ChromeButton label="Minimize" onClick={() => void appWindow.minimize()}>
        <path d="M2 6h8" />
      </ChromeButton>
      {/* Closes to the tray rather than quitting: the proxy is meant to keep
          running while the window is out of the way, and quitting it is a
          decision that belongs in one place — the tray's Exit. */}
      <ChromeButton label="Close to tray" onClick={() => void appWindow.hide()}>
        <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" />
      </ChromeButton>
    </header>
  );
}

function ChromeButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
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
        "hover:bg-hover hover:text-text",
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
