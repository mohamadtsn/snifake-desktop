import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import type { Update } from "@tauri-apps/plugin-updater";
import { Disclosure } from "@/components/Disclosure";
import { checkUpdate } from "@/lib/updater";

type Check = "idle" | "checking" | "current" | "failed";

/**
 * The About panel. It lives at the end of the scrolling column rather than in
 * the fixed furniture at the bottom: it is read once in a while, never during
 * operation, and the panel is only 420px wide — the switch does not give up
 * room for it.
 *
 * The manual check is deliberately louder than the silent one on launch. That
 * one returns null both when we are current and when github.com is
 * unreachable, and saying nothing is right for a check nobody asked for. Here
 * somebody pressed a button, so the two outcomes have to be told apart.
 */
export function AboutSection({
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

  async function run() {
    setCheck("checking");
    try {
      const update = await checkUpdate();
      if (update) {
        setCheck("idle");
        onUpdateFound(update);
      } else {
        setCheck("current");
      }
    } catch {
      setCheck("failed");
    }
  }

  return (
    <Disclosure label="About" open={open} onOpenChange={onOpenChange}>
      <dl className="grid grid-cols-[62px_1fr] items-baseline gap-x-3 gap-y-1.5">
        <Row label="Version" value={version} />
        <Row label="Package" value="io.github.mohamadtsn.snifake" />
        <Row label="Source" value="github.com/mohamadtsn/snifake-desktop" />
        <Row label="License" value="MIT" />
      </dl>

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() => void run()}
          disabled={check === "checking"}
          className="chip text-live border-live/45 hover:border-live h-7 px-2.5 disabled:opacity-30"
        >
          {check === "checking" ? "Checking…" : "Check for updates"}
        </button>
        {/* Height is reserved by the flex row, so a verdict appearing never
            reflows the panel under the pointer. */}
        <span className="text-faint text-[11px]">
          {check === "current" && `Snifake ${version} is the latest version.`}
          {check === "failed" && "Could not reach the update server."}
        </span>
      </div>
    </Disclosure>
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
      <dd dir="ltr" className="text-dim truncate text-left text-[11.5px] leading-none">
        {value || <span className="text-ghost">—</span>}
      </dd>
    </>
  );
}
