import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openFile } from "@tauri-apps/plugin-dialog";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { GroupedList } from "@/components/ui/GroupedList";
import { Icon } from "@/components/ui/Icon";
import { Segmented } from "@/components/ui/Segmented";
import { StatusDot } from "@/components/ui/StatusDot";
import { FIELD_INPUT } from "@/components/ui/FieldRow";
import { middleTruncate, type CoreStatus } from "@/lib/readouts";
import { Section } from "./Section";

type Verify = { kind: "idle" | "checking" } | { kind: "ok" } | { kind: "bad" } | { kind: "error"; message: string };

export function CoreTab({
  core,
  onCoreChanged,
  verbose,
  onVerboseChange,
}: {
  core: CoreStatus | null;
  onCoreChanged: () => void;
  verbose: boolean;
  onVerboseChange: (on: boolean) => void;
}) {
  const [verify, setVerify] = useState<Verify>({ kind: "idle" });
  const [busy, setBusy] = useState(false);

  async function runVerify() {
    setVerify({ kind: "checking" });
    try {
      const ok = await invoke<boolean>("verify_core");
      setVerify({ kind: ok ? "ok" : "bad" });
    } catch (e) {
      // `Err` means the check could not be made at all - no file, unreadable,
      // no pin for this platform - which is a different sentence from
      // "checked, and it is the wrong binary".
      setVerify({ kind: "error", message: String(e) });
    }
  }

  async function replace() {
    setBusy(true);
    try {
      const path = await openFile({
        multiple: false,
        title: "Choose the sing-box release archive",
      });
      if (typeof path !== "string") return;
      await invoke("import_core", { path });
      setVerify({ kind: "idle" });
      onCoreChanged();
    } catch (e) {
      setVerify({ kind: "error", message: String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Section title="Tunnel core binary">
        <div className="flex flex-col gap-3 rounded-lg border border-hairline bg-card p-3 shadow-specular">
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <StatusDot tone={core?.installed ? "ok" : "warn"} size={8} glow={core?.installed} />
              <span className="text-row text-t1">
                {core?.installed ? "Installed" : "Not installed"}
              </span>
            </span>
            <Badge tone={core?.installed ? "ok" : "warn"}>
              {core ? `sing-box v${core.version}` : "unknown"}
            </Badge>
          </div>

          <div>
            <p className="mb-[6px] flex items-baseline justify-between gap-3">
              <span className="text-note font-medium text-t2">Binary executable path</span>
              <span className="text-note text-t3">managed, read-only</span>
            </p>
            <input
              value={core?.path ?? ""}
              readOnly
              dir="ltr"
              aria-label="The core binary's path"
              className={`${FIELD_INPUT} mono pick cursor-text text-left text-t2`}
            />
            {/* Read-only on purpose. The engine verifies a path it is handed
                by an unprivileged process; letting the user point it
                anywhere is the one thing that check cannot cover. */}
            <p className="mt-[6px] text-note leading-[16.5px] text-t3">
              The core lives in a directory this application manages. The engine checks the
              binary against a digest compiled into it before running it as root, which is the
              guarantee; a path the user could move is the one thing that check cannot cover.
            </p>
          </div>

          <div className="flex items-center justify-between gap-3 rounded-md border border-hairline bg-inset px-3 py-[9px]">
            <span className="flex min-w-0 items-center gap-2">
              <span className="text-note text-t3">SHA-256</span>
              <span className="mono pick truncate text-note text-t2" dir="ltr">
                {core?.sha256 ? middleTruncate(core.sha256, 34) : "nothing installed"}
              </span>
            </span>
            <span className="shrink-0">
              {verify.kind === "ok" ? (
                <span className="flex items-center gap-[5px] text-note text-ok">
                  <Icon name="verified" size={14} />
                  Matches the pin
                </span>
              ) : verify.kind === "bad" ? (
                <span className="flex items-center gap-[5px] text-note text-bad">
                  <Icon name="gpp_bad" size={14} />
                  Does not match the pin
                </span>
              ) : verify.kind === "checking" ? (
                <span className="text-note text-t3">Hashing</span>
              ) : (
                <span className="text-note text-t3">Not checked this session</span>
              )}
            </span>
          </div>

          {verify.kind === "error" ? (
            <p role="alert" className="mono text-note leading-[16.5px] break-all text-bad">
              {verify.message}
            </p>
          ) : null}

          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              disabled={!core?.installed || verify.kind === "checking" || busy}
              onClick={() => void runVerify()}
            >
              <Icon name="fingerprint" size={14} />
              Verify hash
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => void replace()}>
              <Icon name="folder_open" size={14} />
              {core?.installed ? "Replace binary" : "Import binary"}
            </Button>
          </div>
          {/* No "Check for core updates". The version is pinned in
              corepin.rs and moves only with an app release (spec 4.2). */}
          <p className="text-note leading-[16.5px] text-t3">
            The version is pinned to this release of Snifake and changes when Snifake does, so
            there is nothing to check for.
          </p>
        </div>
      </Section>

      <Section title="Logging and diagnostics level">
        <GroupedList>
          <GroupedList.Row
            title="Engine verbosity"
            subtitle="Debug logs every packet the sniffer classifies, and only while the log section is open."
            control={
              <Segmented
                size="sm"
                label="Engine verbosity"
                value={verbose ? "debug" : "normal"}
                onChange={(v) => onVerboseChange(v === "debug")}
                options={[
                  { value: "normal", label: "Normal" },
                  { value: "debug", label: "Debug" },
                ]}
              />
            }
          />
        </GroupedList>
        {/* Two segments, not the mockup's four. The engine takes a boolean;
            Error / Warn / Info / Debug would need protocol work, and a
            segment that does nothing is the same lie as a moving bar. */}
      </Section>
    </>
  );
}
