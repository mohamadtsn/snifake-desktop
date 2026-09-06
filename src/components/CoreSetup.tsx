import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open as openFile } from "@tauri-apps/plugin-dialog";
import { UpdateMeter } from "@/components/UpdateMeter";

interface CoreStatus {
  installed: boolean;
  version: string;
  url: string;
}

interface CoreProgress {
  downloaded: number;
  total: number | null;
  percent: number | null;
}

/** Which of the two paths is running, so each button can name its own state. */
type Busy = null | "download" | "import";

/**
 * The gate in front of the whole tunnel section: the core is a separate,
 * GPL-3.0 program and is fetched rather than bundled, so until it is here
 * there is nothing to configure.
 *
 * Import sits beside Download rather than behind a later release, and that
 * is a deliberate call about *this* application's users: a substantial
 * share of them cannot reach github.com, which is exactly why they have
 * this application. Without the manual path, a download failure is a dead
 * end, so the failure state hands over the file name and points at the
 * button that accepts it.
 */
export function CoreSetup({ onInstalled }: { onInstalled: () => void }) {
  const [status, setStatus] = useState<CoreStatus | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [progress, setProgress] = useState<{ received: number; total: number | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void invoke<CoreStatus>("core_status").then(setStatus);
  }, []);

  useEffect(() => {
    const un = listen<CoreProgress>("core-download-progress", (e) =>
      setProgress({ received: e.payload.downloaded, total: e.payload.total }),
    );
    return () => {
      void un.then((f) => f());
    };
  }, []);

  /**
   * `run` returns false when the user backed out rather than failed — the
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
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }

  if (status?.installed) return null;

  return (
    <section className="flex shrink-0 flex-col gap-2.5">
      <h2 className="engrave">Tunnel core</h2>

      {/* Rendered only once the version is known: "sing-box , a separate"
          is what an empty fallback looks like on the first paint. */}
      <p className="text-dim prose-face text-[11.5px] leading-relaxed">
        {status ? (
          <>
            The tunnel runs on sing-box {status.version}, a separate program under a
            different licence. It is fetched once and pinned to this version.
          </>
        ) : (
          "Checking for the tunnel core…"
        )}
      </p>

      <div className="flex items-center gap-2">
        <button
          type="button"
          className="chip"
          disabled={busy !== null}
          onClick={() =>
            void attempt("download", async () => {
              await invoke("download_core");
              return true;
            })
          }
        >
          {busy === "download" ? "Downloading…" : "Download core"}
        </button>
        <button
          type="button"
          className="chip"
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
          {busy === "import" ? "Checking…" : "Import a file"}
        </button>
      </div>

      {busy !== null && <UpdateMeter progress={progress} />}

      {error && (
        <div role="alert" className="flex flex-col gap-1.5">
          <p className="text-st-error prose-face text-[11.5px] leading-relaxed">{error}</p>
          {/* Not a generic "try again". A blocked user needs the exact file
              to fetch by some other route, and then Import brings it in, so
              the recovery is a sentence and an address rather than a bare
              URL they have to guess the purpose of. */}
          <p className="text-dim prose-face text-[11px] leading-relaxed">
            Download this file any way you can, then choose it with Import a file.
          </p>
          <p dir="ltr" className="text-faint value-face pick text-[10px] break-all">
            {status?.url}
          </p>
        </div>
      )}
    </section>
  );
}
