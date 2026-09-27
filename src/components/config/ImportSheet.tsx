import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { ModalSheet } from "@/components/ui/ModalSheet";
import { Segmented } from "@/components/ui/Segmented";
import { StatusDot } from "@/components/ui/StatusDot";
import type { TunnelProfile } from "@/types";

/** Mirrors the `ImportResult` that `import_tunnel` returns. */
export interface ImportResult {
  profile: TunnelProfile;
  warnings: string[];
  /** The address the pasted configuration named. Deliberately kept out of
   *  the profile; the interface offers to reconcile it with the SNI link. */
  source_address: string;
  source_port: number;
}

type Tab = "paste" | "file";

/**
 * Import always produces a tunnel.
 *
 * The mockup offers a choice between "Inbound SNI Link" and "Upstream
 * Tunnel", and there is no such choice to make: there is no share-link
 * format for an SNI profile. The radio pair is gone and one line says where
 * the result lands.
 *
 * Detection is not guessed from the text. Every fact in the panel comes back
 * from `import_tunnel`, which is the same parser that will accept or reject
 * the thing on save, so the preview and the outcome cannot disagree.
 */
export function ImportSheet({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: (profile: TunnelProfile) => void;
}) {
  const [tab, setTab] = useState<Tab>("paste");
  const [text, setText] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) return;
    setText("");
    setResult(null);
    setError(null);
    setFileName(null);
  }, [open]);

  // Parsed as it is typed, through the real parser. `import_tunnel` only
  // parses - it saves nothing - so the preview costs a round trip and
  // nothing else.
  useEffect(() => {
    const body = text.trim();
    if (body === "") {
      setResult(null);
      setError(null);
      return;
    }
    let cancelled = false;
    const id = window.setTimeout(() => {
      void invoke<ImportResult>("import_tunnel", { text: body })
        .then((got) => {
          if (cancelled) return;
          setResult(got);
          setError(null);
        })
        .catch((e) => {
          if (cancelled) return;
          setResult(null);
          setError(String(e));
        });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [text]);

  async function pasteClipboard() {
    try {
      setText(await navigator.clipboard.readText());
    } catch {
      // No clipboard permission under this webview; the textarea still takes
      // an ordinary paste, which is the fallback.
    }
  }

  function readFile(file: File) {
    setFileName(file.name);
    setTab("file");
    const reader = new FileReader();
    reader.onload = () => setText(String(reader.result ?? ""));
    reader.onerror = () => setError(`Could not read ${file.name}.`);
    reader.readAsText(file);
  }

  const p = result?.profile;

  return (
    <ModalSheet
      open={open}
      onOpenChange={onOpenChange}
      icon="download"
      title="Import a tunnel"
      subtitle="Paste a share link, raw Xray JSON, or choose a file"
      width={620}
      footer={
        <>
          <span className="flex min-w-0 items-center gap-2">
            <Icon name="vpn_lock" size={13} className="shrink-0 text-t3" />
            <span className="truncate text-note text-t2">
              The result is added to the tunnel list and becomes the active tunnel.
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-3">
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!p}
              onClick={() => {
                if (!p) return;
                onImported(p);
                onOpenChange(false);
              }}
            >
              <Icon name="check" size={14} />
              Import
            </Button>
          </span>
        </>
      }
    >
      <Segmented
        stretch
        label="Import source"
        value={tab}
        onChange={setTab}
        options={[
          { value: "paste", label: "Paste link or text" },
          { value: "file", label: "File (.json)" },
        ]}
      />

      {tab === "paste" ? (
        <div className="overflow-hidden rounded-lg border border-hairline bg-inset">
          <div className="flex items-center justify-between gap-3 border-b border-hairline px-3 py-[7px]">
            <span className="mono text-note tracking-[0.04em] text-t3 uppercase">
              vless / trojan / xray json
            </span>
            <Button size="sm" variant="ghost" onClick={() => void pasteClipboard()}>
              <Icon name="content_paste" size={13} />
              Paste clipboard
            </Button>
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            dir="ltr"
            aria-label="The link or JSON to import"
            placeholder={"vless://uuid@host:443?type=ws&security=tls&path=%2Fws#Name"}
            className="mono pick block h-[118px] w-full resize-none bg-transparent px-3 py-[10px] text-note leading-[18px] break-all text-t1 placeholder:text-t4 focus:outline-none"
          />
        </div>
      ) : (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer.files[0];
            if (file) readFile(file);
          }}
          className={`flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-7 text-center transition-colors duration-(--dur-fast) ease-(--ease-out) ${
            dragging ? "border-accent bg-accent-soft" : "border-hairline-strong bg-inset"
          }`}
        >
          <Icon name="upload_file" size={24} className="text-t3" />
          <p className="text-row text-t1">
            {fileName ? <span className="mono">{fileName}</span> : "Drop a configuration file here"}
          </p>
          <p className="text-note leading-[16.5px] text-t2">
            Snifake&rsquo;s own JSON export, or an Xray outbound in JSON.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json,text/plain"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) readFile(file);
            }}
          />
          <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>
            <Icon name="folder_open" size={13} />
            Browse for a file
          </Button>
        </div>
      )}

      {/* The detection panel. Every value here came back from the parser, so
          what it shows is exactly what will be saved. */}
      {p ? (
        <div className="overflow-hidden rounded-lg border border-ok-line bg-card">
          <div className="flex items-center justify-between gap-3 border-b border-hairline px-3 py-[9px]">
            <span className="flex min-w-0 items-center gap-2">
              <StatusDot tone="ok" size={8} glow />
              <span className="truncate text-row font-medium text-t1">
                Detected: {p.protocol.toUpperCase()} over WebSocket (TLS)
              </span>
            </span>
            <Badge tone="ok">valid format</Badge>
          </div>

          <dl className="mono grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 px-3 py-[10px] text-note">
            <dt className="text-t3">name</dt>
            <dd className="truncate text-t1">{p.name}</dd>
            <dt className="text-t3">upstream</dt>
            <dd className="truncate text-t1" dir="ltr">
              {p.remote_host}
              {p.path}
            </dd>
            <dt className="text-t3">sni</dt>
            <dd className="truncate text-t1" dir="ltr">
              {p.sni}
            </dd>
            <dt className="text-t3">named address</dt>
            <dd className="truncate text-t2" dir="ltr">
              {result.source_address}:{result.source_port}
            </dd>
          </dl>

          {result.warnings.length > 0 ? (
            <ul className="border-t border-hairline px-3 py-[9px]">
              {result.warnings.map((w) => (
                <li key={w} className="flex items-start gap-2 text-note leading-[16.5px] text-warn">
                  <Icon name="warning" size={13} className="mt-[1px] shrink-0" />
                  {w}
                </li>
              ))}
            </ul>
          ) : null}

          <div className="flex items-center justify-between gap-3 border-t border-hairline px-3 py-[8px]">
            <span className="flex items-center gap-2">
              <span className="text-note text-t3">Accepted</span>
              <Badge>VLESS</Badge>
              <Badge>Trojan</Badge>
              <Badge>Xray JSON</Badge>
            </span>
            <span className="text-note text-warn">VMess is not supported</span>
          </div>
        </div>
      ) : error ? (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-lg border border-bad-line bg-bad-soft px-3 py-[10px]"
        >
          <Icon name="error" size={16} className="mt-[1px] shrink-0 text-bad" />
          <p className="text-note leading-[16.5px] text-t1">{error}</p>
        </div>
      ) : (
        <div className="flex items-start gap-3 rounded-lg border border-hairline bg-inset px-3 py-[10px]">
          <Icon name="info" size={16} className="mt-[1px] shrink-0 text-t3" />
          <p className="text-note leading-[16.5px] text-t2">
            A <span className="mono">vless://</span> or <span className="mono">trojan://</span>{" "}
            share link, or an Xray outbound in JSON. The transport has to be WebSocket with
            standard TLS; anything else is refused with the reason.
          </p>
        </div>
      )}
    </ModalSheet>
  );
}
