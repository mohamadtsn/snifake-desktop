import { useCallback, useEffect, useReducer, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { REFRESH_MS, nextDelay, reduce, type ExitProbe } from "@/lib/exitProbe";
import type { ExitInfo } from "@/types";

/**
 * Asks where the tunnel comes out, a few seconds after each run turns
 * active (`runKey` is that run's start time), then every ten minutes.
 * A generation counter cancels everything a previous run scheduled.
 */
export function useExitProbe(active: boolean, runKey: number | null, enabled: boolean) {
  const [probe, dispatch] = useReducer(reduce, { status: "off" } as ExitProbe);
  const gen = useRef(0);

  const start = useCallback(() => {
    const mine = ++gen.current;
    dispatch({ type: "run" });
    const attempt = (n: number) => {
      const delay = nextDelay(n);
      if (delay === null) return;
      window.setTimeout(async () => {
        if (gen.current !== mine) return;
        try {
          const info = await invoke<ExitInfo>("probe_exit");
          if (gen.current !== mine) return;
          dispatch({ type: "ok", info });
          window.setTimeout(() => gen.current === mine && attempt(0), REFRESH_MS);
        } catch (e) {
          if (gen.current !== mine) return;
          const final = nextDelay(n + 1) === null;
          dispatch({ type: "failed", reason: String(e), final });
          if (!final) attempt(n + 1);
        }
      }, delay);
    };
    attempt(0);
  }, []);

  useEffect(() => {
    if (active && enabled && runKey !== null) {
      start();
    } else {
      gen.current++;
      dispatch({ type: "off" });
    }
  }, [active, enabled, runKey, start]);

  return { probe, recheck: start };
}
