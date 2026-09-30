import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openFile } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Segmented } from "@/components/ui/Segmented";
import { TextField } from "@/components/ui/TextField";
import { formatFromName, ruleSetDefError } from "@/lib/ruleSets";
import type { DefaultRoute, RuleSetDef } from "@/types";

/**
 * Rule sets the user adds by URL or by file; a `ruleset:` line names one by
 * tag. A definition named like a SagerNet tag (`geoip-ir`) replaces the
 * built-in download. Downloads are cached, so only the first start after
 * adding one needs the network.
 */
export function RuleSetList({ defs, onChange }: { defs: RuleSetDef[]; onChange: (defs: RuleSetDef[]) => void }) {
  const [tag, setTag] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  function addUrl() {
    const why = ruleSetDefError(tag, url, defs);
    if (why) return setError(why);
    onChange([...defs, { tag, format: formatFromName(url), source: { type: "remote", url, detour: "proxy" } }]);
    setTag("");
    setUrl("");
    setError(null);
  }

  async function importFile() {
    const why = ruleSetDefError(tag, null, defs);
    if (why) return setError(why);
    const path = await openFile({
      multiple: false,
      title: "Choose a rule set (.srs or .json)",
      filters: [{ name: "Rule set", extensions: ["srs", "json"] }],
    });
    if (typeof path !== "string") return;
    try {
      const def = await invoke<RuleSetDef>("import_rule_set", { path, tag });
      onChange([...defs, def]);
      setTag("");
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  const setDetour = (i: number, detour: DefaultRoute) =>
    onChange(defs.map((d, j) => (j === i && d.source.type === "remote" ? { ...d, source: { ...d.source, detour } } : d)));

  return (
    <section>
      <h2 className="mb-2 px-[2px] text-note font-semibold tracking-[0.55px] text-t2 uppercase">Rule sets</h2>
      <div className="rounded-lg border border-hairline bg-card shadow-specular">
        {defs.map((d, i) => (
          <div key={d.tag} className="flex items-center gap-3 border-b border-hairline px-3 py-2">
            <span className="mono shrink-0 text-note text-t1">{d.tag}</span>
            <span className="mono min-w-0 flex-1 truncate text-note text-t3">
              {d.source.type === "remote" ? d.source.url : d.source.path.split(/[\\/]/).pop()}
            </span>
            {d.source.type === "remote" ? (
              <Segmented
                label={`Download ${d.tag} through`}
                value={d.source.detour}
                onChange={(v) => setDetour(i, v)}
                options={[{ value: "proxy", label: "Tunnel" }, { value: "direct", label: "Direct" }]}
              />
            ) : null}
            <Button size="sm" variant="ghost" onClick={() => onChange(defs.filter((_, j) => j !== i))}>
              <Icon name="delete" size={13} />
            </Button>
          </div>
        ))}
        <div className="grid grid-cols-[1fr_2fr] gap-2 p-3">
          <TextField label="Tag" value={tag} placeholder="geoip-ir" onChange={(v) => setTag(v.trim())} />
          <TextField label="URL" value={url} placeholder="https://…/geoip-ir.srs" onChange={(v) => setUrl(v.trim())} />
        </div>
        <div className="flex items-center justify-between gap-3 px-3 pb-3">
          <span className={`truncate text-note ${error ? "text-bad" : "text-t3"}`}>
            {error ?? "geosite-*/geoip-* tags without a definition download from SagerNet. Downloads are cached."}
          </span>
          <span className="flex shrink-0 gap-2">
            <Button size="sm" variant="secondary" onClick={() => void importFile()}>
              <Icon name="folder_open" size={13} />
              Import file
            </Button>
            <Button size="sm" variant="primary" onClick={addUrl} disabled={!tag || !url}>
              <Icon name="link" size={13} />
              Add URL
            </Button>
          </span>
        </div>
      </div>
    </section>
  );
}
