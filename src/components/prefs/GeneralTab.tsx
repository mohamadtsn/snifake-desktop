import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Badge } from "@/components/ui/Badge";
import { GroupedList } from "@/components/ui/GroupedList";
import { Toggle } from "@/components/ui/Toggle";
import type { Prefs } from "@/lib/prefs";
import { Section } from "./Section";

export function GeneralTab({
  prefs,
  onChange,
}: {
  prefs: Prefs;
  onChange: (patch: Partial<Prefs>) => void;
}) {
  /**
   * The login item's real state, read from the platform rather than from the
   * preference. They can disagree: a user can remove the login item from
   * their desktop environment, and the row has to say what is true.
   *
   * `null` means the plugin could not be reached at all, and the row is then
   * disabled rather than showing a state it does not have.
   */
  const [autostart, setAutostart] = useState<boolean | null>(null);

  useEffect(() => {
    void invoke<boolean>("plugin:autostart|is_enabled")
      .then(setAutostart)
      .catch(() => setAutostart(null));
  }, []);

  async function setLaunchAtLogin(on: boolean) {
    try {
      await invoke(on ? "plugin:autostart|enable" : "plugin:autostart|disable");
      setAutostart(on);
      onChange({ launchAtLogin: on });
    } catch {
      // The platform refused. Leave the row where it was rather than
      // recording a preference the system will not honour.
      setAutostart(await invoke<boolean>("plugin:autostart|is_enabled").catch(() => null));
    }
  }

  return (
    <>
      <Section title="Application and window behaviour">
        <GroupedList>
          <GroupedList.Row
            title="Launch at login"
            subtitle={
              autostart === null
                ? "This platform did not answer, so the login item cannot be changed from here."
                : "Starts Snifake, minimized to the tray, when you sign in."
            }
            control={
              <Toggle
                checked={autostart ?? false}
                onChange={(on) => void setLaunchAtLogin(on)}
                disabled={autostart === null}
                aria-label="Launch at login"
              />
            }
          />
          <GroupedList.Row
            title="Close window minimizes to menu bar"
            badge={<Badge tone="accent">tray mode</Badge>}
            subtitle="With this off, the close glyph asks whether to quit and stop the engine."
            control={
              <Toggle
                checked={prefs.closeToTray}
                onChange={(on) => onChange({ closeToTray: on })}
                aria-label="Close window minimizes to the tray"
              />
            }
          />
          <GroupedList.Row
            title="Colorize menu bar icon by status"
            subtitle="The tray icon takes the state colour: green running, amber waiting, red faulted."
            control={
              <Toggle
                checked={prefs.colorizeTray}
                onChange={(on) => {
                  onChange({ colorizeTray: on });
                  void invoke("set_tray_colorize", { on });
                }}
                aria-label="Colorize the tray icon by status"
              />
            }
          />
        </GroupedList>
      </Section>

      <Section title="Updates and diagnostics">
        <GroupedList>
          <GroupedList.Row
            title="Silent background version checks"
            subtitle="One check when the window opens, silent whether you are current or the server is unreachable."
            control={
              <Toggle
                checked={prefs.silentUpdateChecks}
                onChange={(on) => onChange({ silentUpdateChecks: on })}
                aria-label="Silent background version checks"
              />
            }
          />
        </GroupedList>
        {/* No Release Distribution Channel row. There is one latest.json
            endpoint, so a Stable / Beta-RC pair would be a switch with one
            position (spec 4.2). */}
      </Section>
    </>
  );
}
