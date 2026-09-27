import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Update } from "@tauri-apps/plugin-updater";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { StatusDot } from "@/components/ui/StatusDot";
import { Toggle } from "@/components/ui/Toggle";
import { UpdateMeter } from "@/components/UpdateMeter";
import { checkUpdate } from "@/lib/updater";
import type { Progress } from "@/lib/updater";
import appIcon from "../../../src-tauri/icons/128x128@2x.png";

const REPO = "https://github.com/mohamadtsn/snifake-desktop";

/** What this copy is actually running on. Read from the user agent, and
 *  labelled as the runtime rather than as a build target, because that is
 *  what it is: nothing in the bundle reports the triple it was built for. */
function runtime(): string {
  const ua = globalThis.navigator?.userAgent ?? "";
  const os = /Windows/.test(ua)
    ? "windows"
    : /Mac|iPhone|iPad/.test(ua)
      ? "macos"
      : /Linux|X11/.test(ua)
        ? "linux"
        : "unknown";
  const arch = /aarch64|arm64/.test(ua) ? "arm64" : /x86_64|Win64|x64/.test(ua) ? "x86_64" : "";
  return arch ? `${os} · ${arch}` : os;
}

type Check = "idle" | "checking" | "current" | "failed";

export function AboutTab({
  update,
  onUpdateFound,
  updating,
  progress,
  onInstall,
  silentChecks,
  onSilentChecksChange,
}: {
  update: Update | null;
  onUpdateFound: (u: Update) => void;
  updating: boolean;
  progress: Progress | null;
  onInstall: () => void;
  silentChecks: boolean;
  onSilentChecksChange: (on: boolean) => void;
}) {
  const [version, setVersion] = useState("");
  const [check, setCheck] = useState<Check>("idle");

  useEffect(() => {
    void getVersion().then(setVersion);
  }, []);

  /**
   * Deliberately louder than the silent check on launch. `findUpdate`
   * returns null both when we are current and when github.com is
   * unreachable, and saying nothing is right for a check nobody asked for.
   * Here somebody pressed a button, so the two outcomes have to be told
   * apart.
   */
  async function run() {
    setCheck("checking");
    try {
      const found = await checkUpdate();
      if (found) {
        setCheck("idle");
        onUpdateFound(found);
      } else {
        setCheck("current");
      }
    } catch {
      setCheck("failed");
    }
  }

  return (
    <div className="flex flex-col gap-4 px-5 py-5">
      <Card className="relative overflow-hidden">
        {/* One soft wash, behind everything, so the identity block reads as
            a plate with a light on it rather than a box with a gradient. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(120% 90% at 50% -20%, rgba(0,122,255,0.10), transparent 60%)",
          }}
        />
        <div className="relative flex flex-col items-center gap-3 px-6 py-8">
          {/* The mark is drawn on its own graphite plate, so it stands here
              without a box around it: a plate inside a plate reads as a
              thumbnail, not as the product. */}
          <span className="relative flex size-[88px] items-center justify-center">
            <img src={appIcon} alt="" aria-hidden className="size-[88px]" />
            {/* Before the badge in the DOM, so the badge paints over it. */}
            <span
              aria-hidden
              className="badge-ping pointer-events-none absolute right-[2px] bottom-[2px] size-[22px]"
            />
            <span className="absolute right-[2px] bottom-[2px] flex size-[22px] items-center justify-center rounded-full border-[3px] border-card bg-ok">
              <Icon name="bolt" size={11} className="text-black" />
            </span>
          </span>

          <h1 className="text-title font-semibold tracking-[-0.4px] text-t1">Snifake Desktop</h1>

          <div className="flex items-center gap-2">
            <span className="mono text-body text-t2">v{version || "…"}</span>
            <Badge>{runtime()}</Badge>
          </div>

          <div className="flex items-center gap-3 text-note text-t2">
            <span>MIT licence</span>
            <span className="text-t4">·</span>
            <button
              type="button"
              onClick={() => void openUrl(REPO)}
              className="flex items-center gap-[3px] rounded-sm text-accent hover:underline"
            >
              Source
              <Icon name="open_in_new" size={11} />
            </button>
            <span className="text-t4">·</span>
            <button
              type="button"
              onClick={() => void openUrl(`${REPO}#readme`)}
              className="flex items-center gap-[3px] rounded-sm text-accent hover:underline"
            >
              Documentation
              <Icon name="open_in_new" size={11} />
            </button>
          </div>
        </div>
      </Card>

      <Card>
        <div className="flex flex-col gap-3 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <StatusDot tone={update ? "warn" : "ok"} size={8} glow={Boolean(update)} />
              <h2 className="text-row font-semibold text-t1">Software updates</h2>
            </div>
            {/* The mockup's "DAEMON SYNCED" is not a thing. What is knowable
                is whether an update is waiting and whether we check at all. */}
            <Badge tone={update ? "warn" : silentChecks ? "ok" : "neutral"}>
              {update ? "update waiting" : silentChecks ? "checked on launch" : "checks off"}
            </Badge>
          </div>

          {update ? (
            <div className="flex flex-col gap-3 rounded-md border border-hairline bg-inset px-3 py-3">
              <div className="flex items-start justify-between gap-3">
                <span className="flex min-w-0 items-start gap-3">
                  <Icon name="system_update_alt" size={18} className="mt-[1px] text-accent" />
                  <span className="min-w-0">
                    <span className="block text-row font-medium text-t1">
                      Snifake v{update.version} is available
                    </span>
                    <span className="block text-note text-t2">
                      You are on v{update.currentVersion}
                      {update.date ? ` · released ${update.date.slice(0, 10)}` : ""}
                    </span>
                  </span>
                </span>
                <Badge tone="accent">v{update.version}</Badge>
              </div>

              {update.body ? (
                <p className="mono max-h-[88px] overflow-auto rounded-sm border border-hairline bg-card px-3 py-2 text-note leading-[16.5px] text-t2">
                  {update.body}
                </p>
              ) : null}

              {updating ? <UpdateMeter progress={progress} /> : null}
            </div>
          ) : (
            <p className="flex items-start gap-3 rounded-md border border-hairline bg-inset px-3 py-[10px] text-note leading-[16.5px] text-t2">
              <Icon name="info" size={16} className="mt-[1px] shrink-0 text-t3" />
              {check === "current"
                ? "You are running the latest release."
                : check === "failed"
                  ? "Could not reach the update server. That is often the network this application exists to get around, and it does not affect anything else."
                  : "Updates are signed and verified before they are applied. Nothing is installed without you pressing the button."}
            </p>
          )}

          <div className="flex items-center justify-between gap-3 rounded-md border border-hairline bg-inset px-3 py-[9px]">
            <div className="min-w-0">
              <p className="text-row text-t1">Silent background checks</p>
              <p className="mt-[1px] text-note leading-[16.5px] text-t2">
                One check when the window opens. It is silent whether you are current or the
                server is unreachable.
              </p>
            </div>
            <Toggle
              checked={silentChecks}
              onChange={onSilentChecksChange}
              aria-label="Silent background update checks"
            />
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="primary"
              className="flex-1"
              disabled={!update || updating}
              onClick={onInstall}
            >
              <Icon name="download" size={14} />
              {updating ? "Installing" : "Download and relaunch"}
            </Button>
            <Button variant="secondary" onClick={() => void run()} disabled={check === "checking"}>
              <Icon name="refresh" size={14} />
              {check === "checking" ? "Checking" : "Check again"}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
