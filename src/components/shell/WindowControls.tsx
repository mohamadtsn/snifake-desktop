import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Icon } from "@/components/ui/Icon";

/**
 * The mockups draw macOS traffic lights. This application ships on three
 * platforms with `decorations: false`, so three coloured discs would be a
 * costume on two of them: on Linux and Windows they are not what the user's
 * desktop draws, and they promise macOS behaviour the window does not have.
 *
 * Instead: one neutral cluster of ghost glyph buttons, the same 26px square
 * as the gear beside them. `TitleBar` decides which side it sits on.
 *
 * 26px is the hit area, not the glyph. A 14px icon with a 6px ring of
 * padding is a target the pointer finds without aiming; the glyph alone is
 * not.
 */
function ControlButton({
  label,
  icon,
  onClick,
  danger = false,
}: {
  label: string;
  icon: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`flex size-[26px] items-center justify-center rounded-sm text-t3 transition-[background-color,color] duration-(--dur-press) ease-(--ease-out) hover:text-t1 ${
        danger ? "hover:bg-bad hover:text-white" : "hover:bg-raised-dim"
      }`}
    >
      <Icon name={icon} size={15} />
    </button>
  );
}

/** The width both sides of the title bar reserve, so the centred tab bar
 *  sits in exactly the same place on every platform. */
export const CONTROLS_WIDTH = 26 * 3 + 2 * 2;

export function WindowControls({
  mac,
  onClose,
}: {
  mac: boolean;
  /** Hide to tray, or raise the quit dialog: `App` owns that choice. */
  onClose: () => void;
}) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();
    void win.isMaximized().then(setMaximized);
    const un = win.onResized(() => void win.isMaximized().then(setMaximized));
    return () => {
      void un.then((f) => f());
    };
  }, []);

  const minimize = (
    <ControlButton
      key="min"
      label="Minimize"
      icon="remove"
      onClick={() => void getCurrentWindow().minimize()}
    />
  );
  const maximize = (
    <ControlButton
      key="max"
      label={maximized ? "Restore" : "Maximize"}
      icon={maximized ? "filter_none" : "crop_square"}
      onClick={() => void getCurrentWindow().toggleMaximize()}
    />
  );
  const close = <ControlButton key="close" label="Close" icon="close" onClick={onClose} danger />;

  return (
    <div
      className="flex shrink-0 items-center gap-[2px]"
      style={{ width: CONTROLS_WIDTH }}
    >
      {/* Close-first on macOS, close-last everywhere else: the order is the
          one muscle memory the platform actually holds. */}
      {mac ? [close, minimize, maximize] : [minimize, maximize, close]}
    </div>
  );
}
