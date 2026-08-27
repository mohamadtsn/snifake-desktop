import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

/**
 * Looks for a newer release on GitHub. Returns null when we are current, or
 * when the check fails — a machine that is offline, or behind a filter that
 * blocks github.com (entirely plausible for *this* app's users), must not be
 * told anything: an update is a convenience, never a blocker.
 */
export async function findUpdate(): Promise<Update | null> {
  try {
    return await check();
  } catch {
    return null;
  }
}

/** Downloads, installs, and restarts into the new version. */
export async function applyUpdate(update: Update): Promise<void> {
  await update.downloadAndInstall();
  await relaunch();
}
