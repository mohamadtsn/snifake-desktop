import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { Dialog } from "@base-ui/react/dialog";
import type { Update } from "@tauri-apps/plugin-updater";
import { checkUpdate } from "@/lib/updater";

type Check = "idle" | "checking" | "current" | "failed";

/**
 * About, as a dialog reached from the bezel — which is where every desktop
 * platform already puts it: GNOME's header-bar menu, Windows' Help menu,
 * macOS' app menu. It was an accordion at the foot of the operating panel,
 * a place nobody looks for version metadata and which cost the console
 * height it needed for controls.
 *
 * A `Dialog`, not the `AlertDialog` the rest of the app uses: About asks
 * nothing and decides nothing, so it must be dismissible by Esc, backdrop
 * or Close without a "cancel" reading.
 */
export function AboutDialog({
  open,
  onOpenChange,
  onUpdateFound,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdateFound: (update: Update) => void;
}) {
  const [version, setVersion] = useState("");
  const [check, setCheck] = useState<Check>("idle");

  useEffect(() => {
    void getVersion().then(setVersion);
  }, []);

  // Every visit starts without last visit's verdict still on screen.
  useEffect(() => {
    if (open) setCheck("idle");
  }, [open]);

  /**
   * Deliberately louder than the silent check on launch. That one returns
   * null both when we are current and when github.com is unreachable, and
   * saying nothing is right for a check nobody asked for. Here somebody
   * pressed a button, so the two outcomes have to be told apart.
   */
  async function run() {
    setCheck("checking");
    try {
      const update = await checkUpdate();
      if (update) {
        setCheck("idle");
        onOpenChange(false);
        onUpdateFound(update);
      } else {
        setCheck("current");
      }
    } catch {
      setCheck("failed");
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="dialog-backdrop" />
        <Dialog.Popup className="dialog-popup" aria-labelledby="about-title">
          {/* Identity. The name carries the same engraved uppercase
              treatment as the bezel, two steps up the scale — one product,
              one wordmark, not a different lockup per surface. The hairline
              between name and version is the bezel's separator reused for
              the same job. */}
          <header className="flex items-baseline gap-2.5">
            <h2
              id="about-title"
              className="text-text text-[21px] leading-none uppercase"
              style={{ letterSpacing: "var(--track-label)" }}
            >
              Snifake
            </h2>
            <span className="bg-edge h-3.5 w-px shrink-0 translate-y-px" aria-hidden />
            <span className="text-dim pick text-[12px] leading-none">
              {version || <span className="text-ghost">—</span>}
            </span>
          </header>

          {/* The only prose on the surface, so it is the only thing in the
              sans face. `balance` keeps it off a one-word second line. */}
          <p
            className="prose-face text-dim mt-3 text-[12px] leading-[1.55]"
            style={{ textWrap: "balance" }}
          >
            Forwards TLS connections upstream with a substituted SNI.
          </p>

          <hr className="border-line my-4" />

          {/* Same label-column geometry as the Route block, so the two read as
              the same kind of object rather than two tables that happen to
              share a window. Values are selectable — these get pasted into
              bug reports. */}
          <dl className="grid grid-cols-[58px_1fr] items-baseline gap-x-3 gap-y-2">
            <Row label="Package" value="io.github.mohamadtsn.snifake" />
            <Row label="Source" value="mohamadtsn/snifake-desktop" />
            <Row label="License" value="MIT" />
          </dl>

          {/* The maker's plate. Real equipment carries one, and this is the
              same object the rest of the app uses for a section header — the
              engraved label with a rule running to the edge — so authorship
              is stated in the console's own voice rather than added as one
              more metadata row. The name/handle pair reuses the header's
              hairline idiom for exactly the same reason. */}
          <p className="engrave mt-4">Designed and built by</p>
          <div className="mt-2.5 flex items-baseline gap-2.5">
            <span className="text-text pick text-[13px] leading-none">Mohamad Tsn</span>
            <span className="bg-edge h-3 w-px shrink-0 translate-y-px" aria-hidden />
            <span className="text-dim pick text-[11.5px] leading-none">@mohamadtsn</span>
          </div>

          <hr className="border-line my-4" />

          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => void run()}
              disabled={check === "checking"}
              className="chip h-7 px-2.5 disabled:opacity-30"
            >
              {check === "checking" ? "Checking…" : "Check for updates"}
            </button>
            <Dialog.Close className="chip h-7 px-3">Close</Dialog.Close>
          </div>

          {/* The verdict goes under the action that produced it, not between
              the two buttons — squeezed into that gap it wrapped and orphaned
              its last word. The height is reserved, so a result appearing
              never shifts the button out from under the pointer. */}
          <p
            className="prose-face text-dim mt-2.5 min-h-[15px] text-[11.5px] leading-[1.3]"
            role="status"
          >
            {check === "current" && "You have the latest version."}
            {check === "failed" && "Could not reach the update server."}
          </p>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt
        className="text-faint text-[9.5px] uppercase"
        style={{ letterSpacing: "var(--track-engrave)" }}
      >
        {label}
      </dt>
      {/* `leading-[1.4]`, not `leading-none`: a stack of rows needs vertical
          rhythm, and a single row set solid does not have any. */}
      <dd dir="ltr" className="text-dim pick text-left text-[11.5px] leading-[1.4]">
        {value}
      </dd>
    </>
  );
}
