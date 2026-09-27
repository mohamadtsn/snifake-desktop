import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open as openFile } from "@tauri-apps/plugin-dialog";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { ModalSheet } from "@/components/ui/ModalSheet";
import { UpdateMeter } from "@/components/UpdateMeter";
import type { CoreStatus } from "@/lib/readouts";

interface CoreProgress {
  downloaded: number;
  total: number | null;
  percent: number | null;
}

/** Which of the two paths is running, so each button can name its own state. */
type Busy = null | "download" | "import";

/** The filename the user would be looking for if they fetched it by hand. */
function assetName(url: string): string {
  const last = url.split("/").pop();
  return last && last !== "" ? last : "the release archive";
}

function host(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "the release host";
  }
}

/**
 * The screen that decides whether a blocked user gets the tunnel at all.
 *
 * Import sits beside Download, the same size and the same weight, and that
 * is not symmetry for its own sake: a substantial share of this
 * application's users cannot reach github.com, which is exactly why they
 * have this application. Behind a "having trouble?" link, the manual path
 * would be a dead end with a hint attached.
 *
 * Dismissing is a real answer too. The SNI stage does not need the core, so
 * "not now" leaves a working application rather than a blocked one.
 */
export function CoreSetupModal({
  open,
  onOpenChange,
  onInstalled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInstalled: () => void;
}) {
  const [status, setStatus] = useState<CoreStatus | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [progress, setProgress] = useState<{ received: number; total: number | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    void invoke<CoreStatus>("core_status").then(setStatus);
  }, [open]);

  useEffect(() => {
    const un = listen<CoreProgress>("core-download-progress", (e) =>
      setProgress({ received: e.payload.downloaded, total: e.payload.total }),
    );
    return () => {
      void un.then((f) => f());
    };
  }, []);

  /**
   * `run` returns false when the user backed out rather than failed - the
   * file picker being dismissed is the only case. Treating that as success
   * would fire `onInstalled` for a core that was never installed.
   */
  async function attempt(which: Exclude<Busy, null>, run: () => Promise<boolean>) {
    setBusy(which);
    setError(null);
    setProgress(null);
    try {
      if (!(await run())) return;
      setStatus(await invoke<CoreStatus>("core_status"));
      onInstalled();
      onOpenChange(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }

  const version = status?.version ?? "";
  const url = status?.url ?? "";

  return (
    <ModalSheet
      open={open}
      onOpenChange={onOpenChange}
      icon="warning"
      title="Tunnel core required"
      subtitle={version ? `sing-box v${version}` : undefined}
      width={620}
      tabs={<Badge tone="warn">missing engine</Badge>}
      footer={
        <>
          <span className="min-w-0 text-note text-t3">
            sing-box is GPL-3.0 and is never bundled with this application.
          </span>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy !== null}>
            <Icon name="close" size={13} />
            Use SNI-only mode
          </Button>
        </>
      }
    >
      <p className="text-body leading-[18px] text-t2">
        TUN mode and system-wide interception run on sing-box, a separate program under a
        different licence. It is fetched once and pinned to this exact version; nothing is
        routed through the tunnel until it is here.
      </p>

      <div>
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <h3 className="text-note font-semibold tracking-[0.55px] text-t2 uppercase">
            Acquisition method, either one
          </h3>
          <span className="mono min-w-0 truncate text-note text-t3" dir="ltr">
            {url ? assetName(url) : ""}
          </span>
        </div>

        <div className="grid grid-cols-2 items-stretch gap-3">
          <div className="flex flex-col gap-2 rounded-lg border border-hairline bg-card p-3 shadow-specular">
            <span className="flex items-center gap-2">
              <Icon name="cloud_download" size={16} className="text-accent" />
              <span className="text-row font-semibold text-t1">Automatic fetch</span>
            </span>
            <p className="flex-1 text-note leading-[16.5px] text-t2">
              Downloads the pinned release and checks its digest before unpacking it.
            </p>
            <span className="flex items-center justify-between gap-2 border-t border-hairline pt-2">
              <span className="text-note text-t3">From</span>
              <Badge>{url ? host(url) : "unknown"}</Badge>
            </span>
            {busy === "download" ? (
              <UpdateMeter progress={progress} />
            ) : (
              <Button
                variant="primary"
                disabled={busy !== null || !status}
                onClick={() =>
                  void attempt("download", async () => {
                    await invoke("download_core");
                    return true;
                  })
                }
              >
                <Icon name="download" size={14} />
                {version ? `Download v${version}` : "Download"}
              </Button>
            )}
          </div>

          <div className="flex flex-col gap-2 rounded-lg border border-hairline bg-card p-3 shadow-specular">
            <span className="flex items-center gap-2">
              <Icon name="upload_file" size={16} className="text-accent" />
              <span className="text-row font-semibold text-t1">Manual import</span>
            </span>
            <p className="flex-1 text-note leading-[16.5px] text-t2">
              For a blocked or restricted network. Point at a release archive you already have.
            </p>
            <span className="flex items-center justify-between gap-2 border-t border-hairline pt-2">
              <span className="text-note text-t3">Integrity</span>
              <Badge tone="ok">SHA-256 checked</Badge>
            </span>
            <Button
              variant="secondary"
              disabled={busy !== null}
              onClick={() =>
                void attempt("import", async () => {
                  const path = await openFile({
                    multiple: false,
                    title: "Choose the sing-box release archive",
                  });
                  if (typeof path !== "string") return false;
                  await invoke("import_core", { path });
                  return true;
                })
              }
            >
              <Icon name="folder_open" size={14} />
              {busy === "import" ? "Checking" : "Browse for the archive"}
            </Button>
          </div>
        </div>
      </div>

      {error ? (
        <div
          role="alert"
          className="flex flex-col gap-[6px] rounded-md border border-bad-line bg-bad-soft px-3 py-[10px]"
        >
          <p className="mono text-note leading-[16px] break-all text-bad">{error}</p>
          {/* Not a generic "try again". A blocked user needs the exact file
              to fetch by some other route, after which Import brings it in,
              so the recovery is a sentence and an address rather than a bare
              URL they have to guess the purpose of. */}
          <p className="text-note leading-[16.5px] text-t2">
            Get this file any way you can, then choose it with Manual import.
          </p>
          <p dir="ltr" className="mono pick text-note break-all text-t3">
            {url}
          </p>
        </div>
      ) : (
        <div className="flex items-start gap-3 rounded-md border border-hairline bg-inset px-3 py-[10px]">
          <Icon name="info" size={16} className="mt-[1px] shrink-0 text-t3" />
          <p className="text-note leading-[16.5px] text-t2">
            The SNI link does not need the core and keeps working without it. Only the tunnel
            stage and TUN mode wait for this.
          </p>
        </div>
      )}
    </ModalSheet>
  );
}
