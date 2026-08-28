import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

/**
 * The raw check: null when we are current, and it throws when the server is
 * unreachable. Only the About panel wants that distinction — see findUpdate.
 */
export async function checkUpdate(): Promise<Update | null> {
  return await check();
}

/**
 * Looks for a newer release on GitHub. Returns null when we are current, or
 * when the check fails — a machine that is offline, or behind a filter that
 * blocks github.com (entirely plausible for *this* app's users), must not be
 * told anything: an update is a convenience, never a blocker.
 */
export async function findUpdate(): Promise<Update | null> {
  try {
    return await checkUpdate();
  } catch {
    return null;
  }
}

/** Bytes received so far. `total` is null when the server sent no length. */
export type Progress = { received: number; total: number | null };

/**
 * Downloads, installs, and restarts into the new version, reporting real
 * byte counts as they arrive.
 *
 * The plugin reports each chunk's size, not a running total, so the sum is
 * kept here. `contentLength` is whatever the download server sent and can
 * be absent — a caller that treats a missing total as zero draws a bar that
 * sits at 100% for the whole download.
 */
export async function applyUpdate(
  update: Update,
  onProgress?: (progress: Progress) => void,
): Promise<void> {
  let total: number | null = null;
  let received = 0;
  await update.downloadAndInstall((event) => {
    switch (event.event) {
      case "Started":
        total = event.data.contentLength ?? null;
        onProgress?.({ received: 0, total });
        break;
      case "Progress":
        received += event.data.chunkLength;
        onProgress?.({ received, total });
        break;
      case "Finished":
        // Installing is not measurable, so the bar ends full and the copy
        // takes over from here.
        onProgress?.({ received, total: received });
        break;
    }
  });
  await relaunch();
}
